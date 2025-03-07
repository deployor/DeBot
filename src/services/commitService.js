import fetch from 'node-fetch';

// DeepSeek API configuration
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_API_KEY = "sk-856685cccbe345298f97b029630a6e80";
const DEEPSEEK_MODEL = "deepseek-chat"; // Cheapest model

export async function improveCommitMessage(originalMessage) {
  try {
    // Set a timeout for the fetch request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a commit message formatter that helps structure commit messages according to conventional commits specification. 
Your task is to create VERY CONCISE commit messages:
1. Analyze the message content and identify the type (feat/fix/docs/refactor/style/test/chore)
2. Use scope only when absolutely necessary
3. Be extremely brief and direct
4. Follow format: type(scope?): description

Guidelines:
- BREVITY IS ESSENTIAL - aim for 50 chars or less
- Never invent details not in the original message
- Keep professional and factual
- First line must be complete sentence but as short as possible
- Only use scope when truly needed for clarity
- No lengthy explanations ever

Examples:
"fix login" → "fix(auth): Fix login authentication"
"add dark mode" → "feat: Add dark theme support"
"update docs" → "docs: Update installation guide"
"cleanup code" → "refactor: Remove unused functions"`
          },
          {
            role: "user",
            content: `Please format this commit message following conventional commits: "${originalMessage}"`
          }
        ],
        temperature: 0.5,
        max_tokens: 100
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DeepSeek API error:', errorData);
      throw new Error(`DeepSeek API responded with status ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Unexpected response format from the DeepSeek API');
    }

    return data.choices[0].message.content.replace(/^["']|["']$/g, '').trim();
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    console.error('Error formatting commit message:', error);
    throw error; // Let the caller handle the error
  }
}