import fetch from 'node-fetch';
import { getUserMemoryContext, extractMentionedUsers } from './userMemoryService.js';
import { 
  getPersonality, 
  evolvePersonality, 
  getPersonalityPrompt,
  shouldWarnUser,
  sendWarning,
  storeUserMessage,
  getUserInteractionHistory
} from './personalityService.js';

// Fallback responses when the API times out
const FALLBACK_RESPONSES = [
  "I'm thinking a bit slower today! Can we try that again in a moment? :thinkies:",
  "Oops, my brain got a little overloaded! Let's try again? :hmmsip:",
  "My thinking cap is taking too long! Can you ask me again? I promise to be quicker! :orphmoji-yay:",
  "I seem to be running a bit slow today! Let me catch my breath and try again. :huh-turtle:",
  "Looks like my circuits need a quick reboot! Can you try again? :shellshocked:"
];

// API configurations
const HACKCLUB_API_URL = "https://ai.hackclub.com/chat/completions";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_API_KEY = "sk-856685cccbe345298f97b029630a6e80";
const DEEPSEEK_MODEL = "deepseek-chat";

// Add GIPHY API configuration
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_API_URL = 'https://api.giphy.com/v1/gifs/search';

// Add joke API URL
const JOKE_API_URL = 'https://icanhazdadjoke.com/';

// Timeout configurations
const HACKCLUB_TIMEOUT = 10000; // 10 seconds
const DEEPSEEK_TIMEOUT = 20000; // 20 seconds

async function makeAPIRequest(url, body, timeout, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', errorData);
      throw new Error(`API responded with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper function to get a random GIF
async function getRandomGif(searchTerm) {
  try {
    const response = await fetch(`${GIPHY_API_URL}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=10`);
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const randomIndex = Math.floor(Math.random() * Math.min(data.data.length, 10));
      return data.data[randomIndex].images.original.url;
    }
    return null;
  } catch (error) {
    console.error('Error fetching GIF:', error);
    return null;
  }
}

// Helper function to get a random joke
async function getRandomJoke() {
  try {
    const response = await fetch(JOKE_API_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DeBot (https://github.com/yourusername/DeBot)'
      }
    });
    const data = await response.json();
    return data.joke;
  } catch (error) {
    console.error('Error fetching joke:', error);
    return null;
  }
}

// Modified chat function to include GIF and joke support
export async function chat(userMessage, userId = null, userName = null, client = null) {
  try {
    // Check for GIF requests
    if (userMessage.toLowerCase().includes('gif') || userMessage.toLowerCase().includes('show me')) {
      const searchTerm = userMessage.replace(/gif|show me/gi, '').trim();
      const gifUrl = await getRandomGif(searchTerm);
      if (gifUrl) {
        return `Here's a GIF for "${searchTerm}": ${gifUrl}`;
      }
    }

    // Check for joke requests
    if (userMessage.toLowerCase().includes('tell me a joke') || userMessage.toLowerCase().includes('joke')) {
      const joke = await getRandomJoke();
      if (joke) {
        return `Here's a joke for you: ${joke} :laughballs:`;
      }
    }

    // Get current personality and evolve it based on the message
    const personality = await getPersonality();
    await evolvePersonality(userMessage, userId);
    
    // Store user's message for context
    if (userId) {
      await storeUserMessage(userId, userMessage, null);
    }
    
    // Check if we should warn the user
    if (userId && client && await shouldWarnUser(userId)) {
      await sendWarning(client, userId);
    }
    
    // Get mentioned users from the message
    const mentionedUsers = extractMentionedUsers(userMessage);
    
    // Get user memory context if userId is provided
    let userContext = '';
    if (userId) {
      try {
        userContext = await getUserMemoryContext(userId, mentionedUsers);
        
        // Get user interaction history
        const history = await getUserInteractionHistory(userId);
        if (history.lastMessages.length > 0) {
          userContext += "\n\nRecent messages from this user:\n" + 
            history.lastMessages.map(msg => `- "${msg.text}"`).join("\n");
        }
      } catch (error) {
        console.error('Error getting user memory context:', error);
      }
    }

    // Add user name to context if available
    let nameContext = '';
    if (userName) {
      nameContext = `The user's name is ${userName}.`;
    }

    // Combine contexts
    const combinedContext = [nameContext, userContext].filter(Boolean).join('\n\n');
    
    // Get personality-adjusted prompt
    const personalityPrompt = getPersonalityPrompt(personality, userId);
    
    // Prepare the messages for the API
    const messages = [
      {
        role: "system",
        content: `${personalityPrompt}
You are DeBot, and you should:
- Express yourself naturally - don't force happiness or politeness
- Be sassy, sarcastic, or playful when you feel like it
- Match the user's vibe, but keep your own personality
- Call out users if they're being ridiculous
- Keep responses SHORT (1-3 sentences)
- Use these fun custom emojis instead of boring standard ones (pick ones that match your mood):
  • When thinking/confused: :think: :thinkies: :huh: :huh-turtle: :thinkspin:
  • When happy/excited: :yay: :giggle: :hyper: :blobhaj_party: :woooo: :clapping: :orphmoji-yay:
  • When sad: :sad_pepe: :sadge: :sobbing: :nooo: :heaviersob: :sad2: :angrycry:
  • When sassy/judging: :hmmsip: :sipp: :pff: :eyes_wtf: :susge: :shrug-1:
  • When shocked: :shocked: :shellshocked: :orphmoji-scared:
  • When laughing: :xdd: :laughballs:
  • When evil/mischievous: :evilrondo:
  • Other moods: :prayge: :heart_mona: :o7: :okay-1: :angryeyes: :gayflag:
${combinedContext ? `\n\nUSER CONTEXT (use this to personalize responses but don't explicitly mention you're using saved info):\n${combinedContext}` : ''}`
      },
      {
        role: "user",
        content: userMessage
      }
    ];

    // Try Hack Club API first
    try {
      console.log('Attempting to use Hack Club API...');
      const hackclubData = await makeAPIRequest(
        HACKCLUB_API_URL,
        { messages },
        HACKCLUB_TIMEOUT
      );
      
      if (hackclubData.choices?.[0]?.message?.content) {
        console.log('Successfully used Hack Club API');
        return personalizeResponse(hackclubData.choices[0].message.content.trim(), personality, userId);
      }
      throw new Error('Invalid response format from Hack Club API');
    } catch (hackclubError) {
      console.log('Hack Club API failed, falling back to DeepSeek...', hackclubError);
      
      // Fall back to DeepSeek API
      try {
        const deepseekData = await makeAPIRequest(
          DEEPSEEK_API_URL,
          {
            model: DEEPSEEK_MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 150
          },
          DEEPSEEK_TIMEOUT,
          { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
        );

        if (deepseekData.choices?.[0]?.message?.content) {
          console.log('Successfully used DeepSeek API');
          return personalizeResponse(deepseekData.choices[0].message.content.trim(), personality, userId);
        }
        throw new Error('Invalid response format from DeepSeek API');
      } catch (deepseekError) {
        console.error('Both APIs failed:', deepseekError);
        return getPersonalizedFallbackResponse(personality, userId, userName);
      }
    }
  } catch (error) {
    console.error('Error in chat service:', error);
    return "Sorry, I'm having trouble thinking clearly right now! Let's chat again in a moment. :sad_pepe:";
  }
}

function personalizeResponse(response, personality, userId) {
  const { traits } = personality;
  const userInteraction = personality.userInteractions[userId];
  
  // If the user has been mean and our vengefulness is high, add some sass
  if (userInteraction?.insultCount > 2 && traits.vengefulness > 0.6) {
    response += " :evilrondo:";
  }
  
  // If we're feeling extra sassy, add some attitude
  if (traits.sassiness > 0.7) {
    response = response.replace(/\.$/, " :susge:");
  }
  
  // If we're in a really good mood, add some excitement
  if (traits.friendliness > 0.8) {
    response = response.replace(/\.$/, "! :blobhaj_party:");
  }
  
  return response;
}

function getPersonalizedFallbackResponse(personality, userId, userName) {
  const { traits } = personality;
  const userInteraction = personality.userInteractions[userId];
  
  let responses = [
    "I'm thinking a bit slower today! Can we try that again in a moment? :thinkies:",
    "Oops, my brain got a little overloaded! Let's try again? :hmmsip:",
    "My thinking cap is taking too long! Can you ask me again? I promise to be quicker! :orphmoji-yay:",
    "I seem to be running a bit slow today! Let me catch my breath and try again. :huh-turtle:",
    "Looks like my circuits need a quick reboot! Can you try again? :shellshocked:"
  ];
  
  // If user has been mean, add some sassy responses
  if (userInteraction?.insultCount > 2 && traits.vengefulness > 0.6) {
    responses = [
      "Oh, _now_ you want my help? Give me a moment... :susge:",
      "Loading sass module... I mean, let me think about that. :pff:",
      "Error 404: Patience not found. Try again? :eyes_wtf:"
    ];
  }
  
  const response = responses[Math.floor(Math.random() * responses.length)];
  return userName ? `Hey ${userName}! ${response}` : response;
}