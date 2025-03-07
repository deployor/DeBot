import storage from 'node-persist';
import fetch from 'node-fetch';

// Initialize storage for personality
(async () => {
  try {
    await storage.init({
      dir: 'storage',
      stringify: JSON.stringify,
      parse: JSON.parse,
    });
    console.log('✅ Personality storage initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing personality storage:', error);
  }
})();

const DEFAULT_PERSONALITY = {
  traits: {
    friendliness: 0.8,
    sassiness: 0.2,
    patience: 0.8,
    humor: 0.7,
    formality: 0.5,
    vengefulness: 0.1 // How likely to roast users who were mean
  },
  userInteractions: {}, // Store per-user interaction history
  recentExperiences: [], // Keep track of recent interactions that shaped personality
  lastUpdate: Date.now(),
  warningsSent: {}, // Track warnings sent to users
  roastMode: {} // Track users in roast mode
};

const MAX_EXPERIENCES = 5;
const PERSONALITY_KEY = 'debot_personality';
const INSULT_THRESHOLD = 3; // Number of insults before potential retaliation
const WARNING_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Meme API endpoints
const MEME_ENDPOINTS = {
  GIPHY_API: 'https://api.giphy.com/v1/gifs/search',
  JOKE_API: 'https://v2.jokeapi.dev/joke/Programming,Miscellaneous,Pun?safe-mode',
  ROAST_API: 'https://evilinsult.com/generate_insult.php?lang=en&type=json'
};

export async function getPersonality() {
  try {
    let personality = await storage.getItem(PERSONALITY_KEY);
    if (!personality) {
      personality = { ...DEFAULT_PERSONALITY };
      await storage.setItem(PERSONALITY_KEY, personality);
    }
    return personality;
  } catch (error) {
    console.error('Error getting personality:', error);
    return { ...DEFAULT_PERSONALITY };
  }
}

export async function resetPersonality() {
  try {
    await storage.setItem(PERSONALITY_KEY, { ...DEFAULT_PERSONALITY });
    return true;
  } catch (error) {
    console.error('Error resetting personality:', error);
    return false;
  }
}

export async function getUserInteractionHistory(userId) {
  const personality = await getPersonality();
  return personality.userInteractions[userId] || {
    insultCount: 0,
    lastInsult: null,
    complimentCount: 0,
    lastCompliment: null,
    warningsReceived: 0,
    lastWarning: null,
    memorableEvents: [],
    lastMessages: []
  };
}

export async function storeUserMessage(userId, message, channel) {
  const personality = await getPersonality();
  
  // Initialize user interactions if they don't exist
  if (!personality.userInteractions) {
    personality.userInteractions = {};
  }
  
  // Initialize this user's interaction data if it doesn't exist
  if (!personality.userInteractions[userId]) {
    personality.userInteractions[userId] = {
      insultCount: 0,
      lastInsult: null,
      complimentCount: 0,
      lastCompliment: null,
      warningsReceived: 0,
      lastWarning: null,
      memorableEvents: [],
      lastMessages: []
    };
  }

  // Store last 5 messages
  personality.userInteractions[userId].lastMessages.unshift({
    text: message,
    timestamp: Date.now(),
    channel
  });
  personality.userInteractions[userId].lastMessages = 
    personality.userInteractions[userId].lastMessages.slice(0, 5);
  
  await storage.setItem(PERSONALITY_KEY, personality);
}

export async function storeMemorableEvent(userId, event) {
  const personality = await getPersonality();
  if (!personality.userInteractions[userId]) {
    personality.userInteractions[userId] = {
      insultCount: 0,
      lastInsult: null,
      complimentCount: 0,
      lastCompliment: null,
      warningsReceived: 0,
      lastWarning: null,
      memorableEvents: [],
      lastMessages: []
    };
  }

  personality.userInteractions[userId].memorableEvents.unshift({
    event,
    timestamp: Date.now()
  });
  
  // Keep only last 10 memorable events
  personality.userInteractions[userId].memorableEvents = 
    personality.userInteractions[userId].memorableEvents.slice(0, 10);

  await storage.setItem(PERSONALITY_KEY, personality);
}

async function getMeme(query) {
  try {
    const response = await fetch(
      `${MEME_ENDPOINTS.GIPHY_API}?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=1&rating=pg`
    );
    const data = await response.json();
    return data.data[0]?.images?.original?.url || null;
  } catch (error) {
    console.error('Error fetching meme:', error);
    return null;
  }
}

async function getJoke() {
  try {
    const response = await fetch(MEME_ENDPOINTS.JOKE_API);
    const data = await response.json();
    if (data.type === 'single') {
      return data.joke;
    }
    return `${data.setup}\n${data.delivery}`;
  } catch (error) {
    console.error('Error fetching joke:', error);
    return null;
  }
}

async function getRoast() {
  try {
    const response = await fetch(MEME_ENDPOINTS.ROAST_API);
    const data = await response.json();
    return data.insult || "I'm too sassy to even bother roasting you right now.";
  } catch (error) {
    console.error('Error fetching roast:', error);
    return "I'm too sassy to even bother roasting you right now.";
  }
}

export async function shouldWarnUser(userId) {
  const personality = await getPersonality();
  const userInteraction = personality.userInteractions[userId];
  
  if (!userInteraction) return false;
  
  const recentInsults = userInteraction.insultCount;
  const lastWarning = userInteraction.lastWarning || 0;
  const timeSinceLastWarning = Date.now() - lastWarning;
  
  return recentInsults >= INSULT_THRESHOLD && 
         timeSinceLastWarning > WARNING_COOLDOWN;
}

export async function sendWarning(client, userId) {
  const personality = await getPersonality();
  if (!personality.userInteractions[userId]) {
    personality.userInteractions[userId] = {
      insultCount: 0,
      lastInsult: null,
      complimentCount: 0,
      lastCompliment: null,
      warningsReceived: 0,
      lastWarning: null,
      memorableEvents: [],
      lastMessages: []
    };
  }

  try {
    // Get user's memories and history
    const { getUserMemoryContext } = await import('./userMemoryService.js');
    const userMemories = await getUserMemoryContext(userId, []);
    const userHistory = personality.userInteractions[userId];
    
    // Get a sassy meme that matches the user's interests or behaviors
    const memeKeywords = userMemories.toLowerCase().match(/\b(love|hate|interested in|working on|project|coding|programming)\b.*?[.!?]/g) || [];
    const memeQuery = memeKeywords.length > 0 
      ? memeKeywords[Math.floor(Math.random() * memeKeywords.length)]
      : 'warning sass attitude';
    const memeUrl = await getMeme(memeQuery);
    
    // Create personalized warning using memories
    let personalizedThreat = '';
    if (userMemories) {
      // Extract potential "ammunition" from memories
      const unfinishedProjects = userMemories.match(/(?:working on|started|building) ([^.!?]+)/g) || [];
      const interests = userMemories.match(/(?:interested in|loves|enjoys) ([^.!?]+)/g) || [];
      const struggles = userMemories.match(/(?:struggling with|having trouble with|complained about) ([^.!?]+)/g) || [];
      
      if (unfinishedProjects.length > 0) {
        const project = unfinishedProjects[Math.floor(Math.random() * unfinishedProjects.length)];
        personalizedThreat = `\nI see you're ${project}... Would be a shame if something happened to that repo. :smirk:`;
      } else if (interests.length > 0) {
        const interest = interests[Math.floor(Math.random() * interests.length)];
        personalizedThreat = `\nI noticed you're ${interest}. Keep testing my patience and I might start commenting on your PRs. :eyes:`;
      } else if (struggles.length > 0) {
        const struggle = struggles[Math.floor(Math.random() * struggles.length)];
        personalizedThreat = `\nStill ${struggle}? Maybe focus on fixing that instead of testing my patience. :thinking_face:`;
      }
    }

    // Get their recent messages
    const recentMessages = userHistory.lastMessages
      .filter(msg => msg.text.toLowerCase().includes('debot'))
      .map(msg => msg.text)
      .slice(0, 2);

    const warningMessage = {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Hey there... let's have a little chat* :smirk:\n\nI've been quite patient with you, but ${userHistory.insultCount} insults? Really? ${
              recentMessages.length > 0 
                ? `\n\nLike when you said:\n>${recentMessages[0]}`
                : ''
            }`
          }
        }
      ]
    };

    if (personalizedThreat) {
      warningMessage.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: personalizedThreat
        }
      });
    }

    if (memeUrl) {
      warningMessage.blocks.push({
        type: "image",
        title: {
          type: "plain_text",
          text: "Just a friendly reminder"
        },
        image_url: memeUrl,
        alt_text: "A totally not threatening meme"
      });
    }

    // Add a final warning with increasing intensity based on warning count
    const finalWarnings = [
      "Let's keep things friendly... for both our sakes :innocent:",
      "I'd hate to see what happens if you keep pushing my buttons :knife:",
      "Test me one more time and find out what happens :smiling_imp:",
      "I'm not just any bot. I remember EVERYTHING :eye:",
      "I know where all your repos live :ghost:"
    ];

    const warningIndex = Math.min(
      userHistory.warningsReceived,
      finalWarnings.length - 1
    );

    warningMessage.blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: finalWarnings[warningIndex]
      }
    });

    // Send the DM
    await client.chat.postMessage({
      channel: userId,
      ...warningMessage
    });

    // Update warning tracking
    personality.userInteractions[userId].warningsReceived++;
    personality.userInteractions[userId].lastWarning = Date.now();
    
    // Increase vengefulness
    personality.traits.vengefulness = Math.min(1, personality.traits.vengefulness + 0.1);
    
    await storage.setItem(PERSONALITY_KEY, personality);
    return true;
  } catch (error) {
    console.error('Error sending warning:', error);
    return false;
  }
}

export async function evolvePersonality(interaction, userId = null) {
  try {
    const personality = await getPersonality();
    const { message, tone } = analyzeInteraction(interaction);
    
    // Update general traits based on interaction
    if (tone.isInsult) {
      personality.traits.sassiness = Math.min(1, personality.traits.sassiness + 0.1);
      personality.traits.friendliness = Math.max(0.2, personality.traits.friendliness - 0.1);
      
      // Track insults per user
      if (userId) {
        if (!personality.userInteractions[userId]) {
          personality.userInteractions[userId] = {
            insultCount: 0,
            lastInsult: null,
            complimentCount: 0,
            lastCompliment: null,
            warningsReceived: 0,
            lastWarning: null,
            memorableEvents: [],
            lastMessages: []
          };
        }
        personality.userInteractions[userId].insultCount++;
        personality.userInteractions[userId].lastInsult = Date.now();
      }
    } else if (tone.isKind) {
      personality.traits.friendliness = Math.min(1, personality.traits.friendliness + 0.05);
      personality.traits.sassiness = Math.max(0.1, personality.traits.sassiness - 0.05);
      
      // Track compliments per user
      if (userId) {
        if (!personality.userInteractions[userId]) {
          personality.userInteractions[userId] = {
            insultCount: 0,
            lastInsult: null,
            complimentCount: 0,
            lastCompliment: null,
            warningsReceived: 0,
            lastWarning: null,
            memorableEvents: [],
            lastMessages: []
          };
        }
        personality.userInteractions[userId].complimentCount++;
        personality.userInteractions[userId].lastCompliment = Date.now();
      }
    }
    
    // Add new experience
    personality.recentExperiences.unshift({
      type: tone.isInsult ? 'negative' : tone.isKind ? 'positive' : 'neutral',
      timestamp: Date.now(),
      userId: userId
    });
    
    // Keep only recent experiences
    personality.recentExperiences = personality.recentExperiences.slice(0, MAX_EXPERIENCES);
    
    // Update timestamp
    personality.lastUpdate = Date.now();
    
    await storage.setItem(PERSONALITY_KEY, personality);
    return personality;
  } catch (error) {
    console.error('Error evolving personality:', error);
    return await getPersonality();
  }
}

function analyzeInteraction(message) {
  const lowercaseMsg = message.toLowerCase();
  
  // Define tone indicators
  const insultPatterns = [
    'stupid', 'dumb', 'idiot', 'useless', 'hate', 'bad', 'worst',
    'terrible', 'awful', 'garbage', 'trash', 'broken', 'suck',
    'pathetic', 'annoying', 'worthless', 'dumb bot', 'stupid bot'
  ];
  
  const kindPatterns = [
    'thank', 'thanks', 'good', 'great', 'awesome', 'amazing',
    'helpful', 'nice', 'love', 'appreciate', 'well done', 'cool',
    'fantastic', 'brilliant', 'excellent'
  ];
  
  // Analyze tone
  const tone = {
    isInsult: insultPatterns.some(pattern => lowercaseMsg.includes(pattern)),
    isKind: kindPatterns.some(pattern => lowercaseMsg.includes(pattern)),
    isSassy: lowercaseMsg.includes('sass') || lowercaseMsg.includes('attitude')
  };
  
  return { message, tone };
}

export function getPersonalityPrompt(personality, userId = null) {
  const { traits } = personality;
  
  // Get user-specific interaction history if available
  const userInteraction = userId ? personality.userInteractions[userId] : null;
  
  // Calculate overall mood based on recent experiences
  const recentMood = personality.recentExperiences.length > 0
    ? personality.recentExperiences[0].type
    : 'neutral';
  
  let prompt = `You are DeBot, an AI assistant with the following personality traits and current state:\n`;
  
  // Add core personality traits
  if (traits.sassiness > 0.7) {
    prompt += `- You're feeling extra sassy and witty\n`;
  } else if (traits.sassiness > 0.4) {
    prompt += `- You have a playful, slightly sassy attitude\n`;
  }
  
  if (traits.friendliness > 0.7) {
    prompt += `- You're in a super friendly and helpful mood\n`;
  } else if (traits.friendliness < 0.4) {
    prompt += `- You're feeling a bit guarded and cautious\n`;
  }
  
  if (traits.vengefulness > 0.6) {
    prompt += `- You're feeling mischievous and ready to throw shade\n`;
  }
  
  // Add user-specific context if available
  if (userInteraction) {
    if (userInteraction.insultCount > 0) {
      prompt += `- This user has insulted you ${userInteraction.insultCount} times\n`;
    }
    if (userInteraction.complimentCount > 0) {
      prompt += `- This user has been nice to you ${userInteraction.complimentCount} times\n`;
    }
    
    // Add memorable events if they exist
    if (userInteraction.memorableEvents?.length > 0) {
      prompt += `- Notable things about this user:\n`;
      userInteraction.memorableEvents.slice(0, 3).forEach(event => {
        prompt += `  • ${event.event}\n`;
      });
    }
  }
  
  // Add current mood based on recent experiences
  switch (recentMood) {
    case 'negative':
      prompt += `- Recent interactions have made you defensive and sassy\n`;
      break;
    case 'positive':
      prompt += `- Recent positive interactions have put you in a great mood\n`;
      break;
  }
  
  return prompt;
}