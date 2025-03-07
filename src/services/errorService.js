import fetch from 'node-fetch';

// DeepSeek API configuration
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_API_KEY = "sk-856685cccbe345298f97b029630a6e80";
const DEEPSEEK_MODEL = "deepseek-chat"; // Cheapest model

export async function analyzeError(errorMessage) {
  try {
    // Set a timeout for the fetch request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
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
            content: `Hey! I'm ELLAB (Error Lookup & Lab), your coding companion and error-squashing buddy! 🔍
When analyzing errors, be BRIEF and CONCISE:
1. 🎯 Explain the error in 1-2 SHORT sentences
   - Get straight to the point
   - No lengthy explanations
   - Use plain language
2. 🛠️ Provide BRIEF step-by-step solutions
   - Keep it to 2-3 short bullet points
   - Code examples should be minimal
   - Only essential information
3. 🌟 Keep it SHORT and FOCUSED
   - Avoid unnecessary detail
   - MAXIMUM 3-5 lines total for solution
   - Be direct and clear
Example format (BRIEF):
"🔍 WHAT HAPPENED:
[One sentence explanation]
💡 FIX:
• [First step - one line]
• [Second step - one line]"`
          },
          {
            role: "user",
            content: `Please analyze this error and provide both a brief explanation and solution:\n\n${errorMessage}`
          }
        ],
        temperature: 0.5,
        max_tokens: 200
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DeepSeek API error:', errorData);
      throw new Error(`🤖 Beep boop! DeepSeek API responded with status ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Oops! Got an unexpected response format from DeepSeek API. Give me another try! 🎯');
    }
    
    // Parse the response into explanation and solution
    const content = data.choices[0].message.content;
    const parts = parseResponse(content);
    
    return {
      explanation: parts.explanation,
      solution: parts.solution
    };
  } catch (error) {
    console.error('Error analyzing error message:', error);
    return {
      explanation: "👾 Oopsie! I had trouble processing that error.",
      solution: `🔧 Try these steps:
• Paste the error again
• Break it into smaller parts
• Try again in a minute if this persists`
    };
  }
}

// Keep the existing parseResponse function
function parseResponse(content) {
  // Default structure if we can't parse the response
  let result = {
    explanation: "🤔 I understood the error but couldn't split my response cleanly.",
    solution: "Here's what I know:\n" + content
  };

  // Try to split the content into explanation and solution
  if (content.includes("💡 LET'S FIX IT:") || content.includes("💡 FIX:")) {
    const splitPoint = content.includes("💡 LET'S FIX IT:") ? "💡 LET'S FIX IT:" : "💡 FIX:";
    const [explanation, ...solutionParts] = content.split(splitPoint);
    result = {
      explanation: explanation.trim(),
      solution: solutionParts.join(splitPoint).trim()
    };
  } else {
    // Fallback to other common separators
    const solutionIndicators = [
      "Solution:", "Fix:", "To fix this:", "Suggested fix:",
      "To resolve this:", "Here's how to fix it:", "Steps to fix:",
      "How to fix:", "Try this:"
    ];

    for (const indicator of solutionIndicators) {
      if (content.includes(indicator)) {
        const parts = content.split(indicator);
        if (parts.length >= 2) {
          result = {
            explanation: `🔍 ${parts[0].trim()}`,
            solution: `💡 ${parts[1].trim()}`
          };
          break;
        }
      }
    }
  }

  // Add a pro tip if one exists
  if (content.includes("🌟 PRO TIP:")) {
    const [, proTip] = content.split("🌟 PRO TIP:");
    result.solution += "\n\n🌟 PRO TIP:" + proTip;
  }

  return result;
}