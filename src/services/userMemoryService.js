import storage from 'node-persist';
import fetch from 'node-fetch';

// Initialize storage
(async () => {
  try {
    await storage.init({
      dir: 'storage',
      stringify: JSON.stringify,
      parse: JSON.parse,
    });
    console.log('✅ User memory storage initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing user memory storage:', error);
  }
})();

// Memory constants
const MAX_MEMORY_LENGTH = 300; // Increased from 100 to 300 words per user
const MEMORY_KEY_PREFIX = 'user_memory_';
const MEMORY_IMPORTANCE_THRESHOLD = 0.5; // Lowered threshold to be more inclusive
const MAX_MENTIONED_USERS_MEMORIES = 3; // Max number of memories to include per mentioned user

/**
 * Store memory for a specific user
 * @param {string} userId - Slack user ID
 * @param {string} newMemory - New memory to store
 * @param {string} userDisplayName - User's display name (optional)
 * @param {number} importance - Importance score (0-1)
 */
export async function storeUserMemory(userId, newMemory, userDisplayName = null, importance = 1.0) {
  try {
    // Get existing memories
    const memories = await getUserMemories(userId);
    
    // Update user display name if provided
    if (userDisplayName) {
      memories.displayName = userDisplayName;
    }
    
    // Don't store duplicate memories (check last 5 entries)
    const recentMemories = memories.items.slice(0, 5).map(item => item.text.toLowerCase());
    if (recentMemories.includes(newMemory.toLowerCase())) {
      console.log(`Skipping duplicate memory for ${userId}: "${newMemory}"`);
      return true;
    }
    
    // Add new memory to the beginning of the array
    memories.items.unshift({
      text: newMemory,
      timestamp: Date.now(),
      importance: importance
    });
    
    // Keep only enough memories to stay under word limit
    let wordCount = 0;
    let cutoffIndex = memories.items.length;
    
    for (let i = 0; i < memories.items.length; i++) {
      wordCount += countWords(memories.items[i].text);
      if (wordCount > MAX_MEMORY_LENGTH) {
        cutoffIndex = i;
        break;
      }
    }
    
    // If we're over the word limit, choose which memories to keep based on importance
    if (cutoffIndex < memories.items.length) {
      // Sort memories by importance (keeping the most recent ones near the top)
      const recentBonus = 0.2; // Bonus for recent memories
      
      for (let i = 0; i < memories.items.length; i++) {
        // Apply recency bonus that decays with position
        const recencyFactor = Math.max(0, recentBonus - (i * 0.01));
        memories.items[i].adjusted_importance = memories.items[i].importance + recencyFactor;
      }
      
      // Sort by adjusted importance
      memories.items.sort((a, b) => b.adjusted_importance - a.adjusted_importance);
      
      // Keep only enough memories to stay under the word limit
      let newWordCount = 0;
      const keptMemories = [];
      
      for (const memory of memories.items) {
        const memoryWordCount = countWords(memory.text);
        
        if (newWordCount + memoryWordCount <= MAX_MEMORY_LENGTH && 
            memory.importance >= MEMORY_IMPORTANCE_THRESHOLD) {
          keptMemories.push(memory);
          newWordCount += memoryWordCount;
        }
      }
      
      memories.items = keptMemories;
    }
    
    // Store updated memories
    await storage.setItem(`${MEMORY_KEY_PREFIX}${userId}`, memories);
    return true;
  } catch (error) {
    console.error(`Error storing user memory for ${userId}:`, error);
    return false;
  }
}

/**
 * Get all memories for a user
 * @param {string} userId - Slack user ID
 * @returns {Object} User memories object with items array
 */
export async function getUserMemories(userId) {
  try {
    const memories = await storage.getItem(`${MEMORY_KEY_PREFIX}${userId}`);
    return memories || { userId, displayName: null, items: [] };
  } catch (error) {
    console.error(`Error retrieving user memories for ${userId}:`, error);
    return { userId, displayName: null, items: [] };
  }
}

/**
 * Extract memory context text for AI prompts, including mentioned users
 * @param {string} userId - Slack user ID
 * @param {Array} mentionedUsers - Array of mentioned user IDs (optional)
 * @returns {string} Formatted memory text for AI context
 */
export async function getUserMemoryContext(userId, mentionedUsers = []) {
  try {
    // Get main user memories
    const memories = await getUserMemories(userId);
    let contextParts = [];
    
    // Format user's own memories
    if (memories.items.length > 0) {
      const memoryLines = memories.items.map(item => item.text);
      const userPrefix = `Previous interactions with ${memories.displayName || 'this user'}:`;
      contextParts.push(`${userPrefix}\n- ${memoryLines.join('\n- ')}`);
    }
    
    // Get memories for mentioned users (if any)
    if (mentionedUsers && mentionedUsers.length > 0) {
      for (const mentionedUser of mentionedUsers) {
        if (mentionedUser === userId) continue; // Skip if it's the same user
        
        const userMemories = await getUserMemories(mentionedUser);
        if (userMemories.items.length > 0) {
          // Take only the most important memories for mentioned users
          const sortedMemories = userMemories.items
            .sort((a, b) => b.importance - a.importance)
            .slice(0, MAX_MENTIONED_USERS_MEMORIES);
          
          const memoryLines = sortedMemories.map(item => item.text);
          const mentionPrefix = `What I know about <@${mentionedUser}> (${userMemories.displayName || 'mentioned user'}):`;
          contextParts.push(`${mentionPrefix}\n- ${memoryLines.join('\n- ')}`);
        }
      }
    }
    
    return contextParts.join('\n\n');
  } catch (error) {
    console.error(`Error creating memory context:`, error);
    return '';
  }
}

/**
 * Store memory about a mentioned user
 * @param {string} mentionedUserId - Mentioned user's Slack ID
 * @param {string} memory - Memory about mentioned user
 * @param {string} observerId - User who mentioned someone
 */
export async function storeMentionedUserMemory(mentionedUserId, memory, observerId) {
  try {
    // Get mentioned user's name if available
    let mentionedUserName = null;
    try {
      const mentionedMemories = await getUserMemories(mentionedUserId);
      mentionedUserName = mentionedMemories.displayName;
    } catch (e) {
      // Ignore errors here
    }
    
    // Get observer's name if available
    let observerName = null;
    try {
      const observerMemories = await getUserMemories(observerId);
      observerName = observerMemories.displayName;
    } catch (e) {
      // Ignore errors here
    }
    
    // Format the memory with context
    const observerLabel = observerName ? `${observerName} (<@${observerId}>)` : `<@${observerId}>`;
    const memoryText = `Mentioned by ${observerLabel}: ${memory}`;
    
    // Store with slightly lower importance
    await storeUserMemory(mentionedUserId, memoryText, mentionedUserName, 0.8);
    return true;
  } catch (error) {
    console.error(`Error storing mentioned user memory for ${mentionedUserId}:`, error);
    return false;
  }
}

/**
 * Extract user IDs from a message
 * @param {string} text - Message text
 * @returns {Array} Array of user IDs mentioned
 */
export function extractMentionedUsers(text) {
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  
  return mentions;
}

/**
 * Count words in a string
 * @param {string} text - Text to count words in
 * @returns {number} Word count
 */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Analyze message for important information to remember
 * @param {string} message - User message
 * @returns {Promise<Object>} Object with memorable content and importance score
 */
export async function analyzeMessageImportance(message) {
  try {
    // Common patterns worth remembering (fallback if AI analysis fails)
    const personalPatterns = [
      { regex: /my name is\s+(\w+)/i, importance: 0.9 },
      { regex: /i(?:'m| am)\s+([^.,:;!?]+)/i, importance: 0.8 },
      { regex: /i live in\s+([^.,:;!?]+)/i, importance: 0.9 },
      { regex: /i work(?: as| at| for)?\s+([^.,:;!?]+)/i, importance: 0.8 },
      { regex: /i like|love|enjoy|prefer\s+([^.,:;!?]+)/i, importance: 0.7 },
      { regex: /my favorite\s+([^.,:;!?]+)/i, importance: 0.7 },
      { regex: /i(?:'ve| have)\s+([^.,:;!?]+)/i, importance: 0.6 },
      { regex: /i(?:'ll| will)\s+([^.,:;!?]+)/i, importance: 0.6 },
      { regex: /(?:don't|do not) (?:like|want|enjoy)\s+([^.,:;!?]+)/i, importance: 0.7 },
      { regex: /my hobby is\s+([^.,:;!?]+)/i, importance: 0.7 },
      { regex: /i(?:'m| am) (?:a|an)\s+([^.,:;!?]+)/i, importance: 0.8 },
      { regex: /i can(?:'t| not)?\s+([^.,:;!?]+)/i, importance: 0.6 },
      { regex: /i know\s+([^.,:;!?]+)/i, importance: 0.7 },
      { regex: /i remember\s+([^.,:;!?]+)/i, importance: 0.8 },
      { regex: /i told you\s+([^.,:;!?]+)/i, importance: 0.9 },
      { regex: /do you remember\s+([^.,:;!?]+)/i, importance: 0.9 },
      { regex: /remember when\s+([^.,:;!?]+)/i, importance: 0.9 }
    ];
    
    // Check for important patterns
    for (const pattern of personalPatterns) {
      const match = message.match(pattern.regex);
      if (match) {
        return {
          content: match[0],
          importance: pattern.importance
        };
      }
    }
    
    // If no patterns matched but the message contains questions about memory
    if (message.toLowerCase().includes('remember') || 
        message.toLowerCase().includes('forgot') || 
        message.toLowerCase().includes('told you')) {
      return {
        content: message.length > 100 ? message.substring(0, 100) + '...' : message,
        importance: 0.85 // High importance for memory-related queries
      };
    }
    
    // Check for statements that might be facts worth remembering
    if (message.includes(' is ') || message.includes(' are ') || 
        message.includes(' was ') || message.includes(' were ') ||
        message.includes(' has ') || message.includes(' have ')) {
      return {
        content: message.length > 100 ? message.substring(0, 100) + '...' : message,
        importance: 0.7 // Medium-high importance for factual statements
      };
    }
    
    // For all other messages, consider with medium importance
    return {
      content: message.length > 100 ? message.substring(0, 100) + '...' : message,
      importance: 0.5 // Medium importance for general messages
    };
  } catch (error) {
    console.error('Error analyzing message importance:', error);
    return {
      content: message.length > 50 ? message.substring(0, 50) + '...' : message,
      importance: 0.5 // Default importance
    };
  }
}

/**
 * Extract the most important information from a message to remember
 * @param {string} message - User message
 * @returns {Promise<string|null>} Important details or null if none found
 */
export async function findMemorableDetails(message) {
  try {
    // Skip very short messages
    if (message.length < 5) return null;
    
    // Analyze message for importance
    const analysis = await analyzeMessageImportance(message);
    
    // Only remember if importance is above threshold
    if (analysis.importance >= MEMORY_IMPORTANCE_THRESHOLD) {
      return analysis.content;
    }
    
    return null;
  } catch (error) {
    console.error('Error finding memorable details:', error);
    return null;
  }
}