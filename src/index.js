import pkg from '@slack/bolt';
const { App, ExpressReceiver } = pkg;
import dotenv from 'dotenv';
import express from 'express';
import storage from 'node-persist';
import { handlePrinterWebhook } from './services/printerService.js';
import { improveCommitMessage } from './services/commitService.js';
import { analyzeError } from './services/errorService.js';
import { chat } from './services/chatService.js';
import { 
  storeUserMemory, 
  extractMentionedUsers, 
  findMemorableDetails,
  storeMentionedUserMemory 
} from './services/userMemoryService.js';

dotenv.config();

// Initialize storage
await storage.init({
  dir: 'storage',
  stringify: JSON.stringify,
  parse: JSON.parse,
});

// Initialize the custom receiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

// Create the Bolt app with the custom receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver
});

// Get the Express app instance
const server = receiver.app;
server.use(express.json());

// Set up routes before other middleware
server.post('/printer-webhook', async (req, res) => {
  await handlePrinterWebhook(req.body, app);
  res.status(200).send('OK');
});

// Welcome message function
async function sendWelcomeMessage() {
  try {
    // Check if startup message is enabled
    const startupMessageEnabled = await storage.getItem('startupMessageEnabled');
    if (startupMessageEnabled === false) {
      console.log('Startup message is disabled');
      return;
    }

    await app.client.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🤖 *Sup everyone! DeBot is online!*\n\nI'm here to help with:\n" +
                  "• 🖨️ Watching deployor's prints\n" +
                  "• ✨ Making commit messages better (`/commiti`)\n" +
                  "• 🔍 Fixing errors (`ELLAB:`)\n" +
                  "• 🧹 Purging messages (`/purgeee`)"
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
}

// Commit message improvement command (renamed to commiti)
app.command('/commiti', async ({ command, ack, respond }) => {
  // Immediately acknowledge the command
  await ack();
  
  const message = command.text.trim();
  if (!message) {
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        response_type: 'ephemeral',
        text: "Please provide a commit message to format."
      });
    } catch (error) {
      console.error('Error sending response:', error);
    }
    return;
  }
  
  try {
    // Use response_url to send the "working on it" message
    const axios = (await import('axios')).default;
    await axios.post(command.response_url, {
      response_type: 'ephemeral',
      text: 'Formatting your commit message...'
    });
    
    const improvedMessage = await improveCommitMessage(message);
    
    // Send the final result
    await axios.post(command.response_url, {
      response_type: 'in_channel',
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Original:*\n\`${message}\`\n\n*Formatted:*\n\`${improvedMessage}\``
          }
        }
      ],
      replace_original: true
    });
  } catch (error) {
    console.error('Error formatting commit message:', error);
    try {
      const axios = (await import('axios')).default;
      let errorMessage = "Unable to format commit message at the moment.";
      if (error.message === 'Request timed out') {
        errorMessage = "The request timed out. Please try again.";
      }
      
      await axios.post(command.response_url, {
        response_type: 'ephemeral',
        text: errorMessage,
        replace_original: true
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

// Message purge command
app.command('/purgeee', async ({ command, ack, respond, client }) => {
  // Immediately acknowledge the command
  await ack();
  
  // Check if the user is authorized
  if (command.user_id !== 'U078PH0GBEH') {
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        text: "Sorry! Only deployor can use this command! 🔒",
        response_type: 'ephemeral'
      });
    } catch (error) {
      console.error('Error sending response:', error);
    }
    return;
  }

  // Parse the number of messages to delete
  const numberToDelete = parseInt(command.text.trim());
  if (command.text.trim() && isNaN(numberToDelete)) {
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        text: "Please provide a valid number of messages to delete, or leave empty to delete all messages.",
        response_type: 'ephemeral'
      });
    } catch (error) {
      console.error('Error sending response:', error);
    }
    return;
  }
  
  try {
    // Initial response to show we're working
    const axios = (await import('axios')).default;
    await axios.post(command.response_url, {
      text: `🧹 Starting cleanup${numberToDelete ? ` of ${numberToDelete} message(s)` : ''}, this might take a while...`,
      response_type: 'ephemeral'
    });

    let cursor;
    let allMessages = [];
    let shouldBreak = false;
    
    // Keep fetching messages until we have all of them or hit the 1000 message limit
    do {
      const result = await client.conversations.history({
        channel: command.channel_id,
        cursor: cursor,
        limit: 200 // Maximum per request
      });

      if (!result.messages) break;
      
      allMessages = allMessages.concat(result.messages);
      cursor = result.response_metadata?.next_cursor;
      
      // Break if we hit 1000 messages (Slack's practical limit) or have enough messages
      if (allMessages.length >= 1000 || (numberToDelete && allMessages.length >= numberToDelete * 2)) {
        // Get more than we need because some might not be deletable
        break;
      }
      
      // Add a small delay between pagination requests
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } while (cursor);

    if (allMessages.length === 0) {
      await axios.post(command.response_url, {
        text: "No messages found to delete! 🤷‍♂️",
        response_type: 'ephemeral'
      });
      return;
    }

    // Filter only messages from the bot
    const now = Date.now() / 1000;
    const deletableMessages = allMessages.filter(msg => {
      // Only include messages from the bot
      const isFromBot = Boolean(msg.bot_id);
      
      // Check if message is not too old (within last 24 hours to be extra safe)
      const isRecent = (now - parseFloat(msg.ts)) < (24 * 60 * 60);
      
      return isRecent && isFromBot;
    });

    if (deletableMessages.length === 0) {
      await axios.post(command.response_url, {
        text: "⚠️ I couldn't find any recent messages from me to delete!",
        response_type: 'ephemeral'
      });
      return;
    }

    // If numberToDelete is specified, limit the array
    const messagesToDelete = numberToDelete 
      ? deletableMessages.slice(0, numberToDelete)
      : deletableMessages;

    // Delete messages with increased delays and chunking
    let deletedCount = 0;
    let failedCount = 0;
    const chunkSize = 5;
    
    // Process messages in chunks
    for (let i = 0; i < messagesToDelete.length; i += chunkSize) {
      // Break if we've deleted enough messages
      if (numberToDelete && deletedCount >= numberToDelete) {
        break;
      }
      
      const chunk = messagesToDelete.slice(i, i + chunkSize);
      
      // Update progress every 20 messages or when we're done
      if (i % 20 === 0 || i + chunkSize >= messagesToDelete.length) {
        await axios.post(command.response_url, {
          text: `🧹 Progress: Deleted ${deletedCount} message${deletedCount !== 1 ? 's' : ''} so far...${
            numberToDelete ? ` (Target: ${numberToDelete})` : ''
          }`,
          response_type: 'ephemeral'
        });
      }
      
      // Process each message in the chunk
      for (const message of chunk) {
        // Break if we've deleted enough messages
        if (numberToDelete && deletedCount >= numberToDelete) {
          break;
        }

        try {
          // Add longer delay between deletions
          if (deletedCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          await client.chat.delete({
            channel: command.channel_id,
            ts: message.ts
          });
          deletedCount++;
          
          // Break if we've deleted enough messages
          if (numberToDelete && deletedCount >= numberToDelete) {
            break;
          }
          
        } catch (error) {
          console.error('Error deleting message:', error);
          failedCount++;
          
          // On timeout, take a longer break
          if (error?.data?.error === 'operation_timeout') {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          // On rate limit, pause for the specified time
          if (error?.data?.error === 'ratelimited') {
            const retryAfter = parseInt(error.headers?.['retry-after'] || '5');
            await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
          }
        }
      }
      
      // Break if we've deleted enough messages
      if (numberToDelete && deletedCount >= numberToDelete) {
        break;
      }
      
      // Add a pause between chunks
      if (i + chunkSize < messagesToDelete.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Send final status
    let statusMessage = `🧹 Cleanup complete!\n• Deleted: ${deletedCount} message${deletedCount !== 1 ? 's' : ''}`;
    if (failedCount > 0) {
      statusMessage += `\n• Failed: ${failedCount} message${failedCount !== 1 ? 's' : ''}`;
    }
    if (numberToDelete) {
      statusMessage += `\n• Requested: ${numberToDelete} message${numberToDelete !== 1 ? 's' : ''}`;
    }
    await axios.post(command.response_url, {
      text: statusMessage,
      response_type: 'ephemeral'
    });
  } catch (error) {
    console.error('Error purging messages:', error);
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        text: "Oops! 😅 Something went wrong while trying to clean up the messages. The channel might be too busy, try again in a few minutes?",
        response_type: 'ephemeral'
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

// Error analysis command
app.message(/^ELLAB:(.+)$/s, async ({ message, say }) => {
  const errorMessage = message.text.replace('ELLAB:', '').trim();
  try {
    const analysis = await analyzeError(errorMessage);
    await say({
      text: "🔍 Analyzing your error...",
      thread_ts: message.ts,
      reply_broadcast: false
    });
    
    // Use chat.postEphemeral to make the response only visible to the user
    await app.client.chat.postEphemeral({
      channel: message.channel,
      user: message.user,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔍 *Error Analysis Results:*"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: analysis.explanation
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "💡 *Suggested Fix:*\n" + analysis.solution
          }
        }
      ]
    });
  } catch (error) {
    await app.client.chat.postEphemeral({
      channel: message.channel,
      user: message.user,
      text: "Whoopsie! 🤔 Even a multipurpose bot like me gets confused sometimes! Can you try explaining that error differently?"
    });
  }
});

// Error analysis slash command
app.command('/ellab', async ({ command, ack, respond }) => {
  // Immediately acknowledge the command
  await ack();

  const errorMessage = command.text.trim();
  if (!errorMessage) {
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        response_type: 'ephemeral',  // Ensures only the requesting user sees this
        text: "Please provide an error message to analyze. Example: `/ellab TypeError: Cannot read property 'x' of undefined`"
      });
    } catch (error) {
      console.error('Error sending response:', error);
    }
    return;
  }

  try {
    // Send "analyzing" message via response_url
    const axios = (await import('axios')).default;
    await axios.post(command.response_url, {
      response_type: 'ephemeral',  // Ensures only the requesting user sees this
      text: "🔍 Analyzing your error..."
    });
    
    const analysis = await analyzeError(errorMessage);
    
    // Send the final response
    await axios.post(command.response_url, {
      response_type: 'ephemeral',  // Ensures only the requesting user sees this
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔍 *Error Analysis Results:*"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: analysis.explanation
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "💡 *Suggested Fix:*\n" + analysis.solution
          }
        }
      ],
      replace_original: true
    });
  } catch (error) {
    console.error('Error analyzing error:', error);
    try {
      const axios = (await import('axios')).default;
      await axios.post(command.response_url, {
        response_type: 'ephemeral',  // Ensures only the requesting user sees this
        text: "Sorry, I had trouble analyzing that error. Could you try rephrasing it?",
        replace_original: true
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

// Startup message toggle command
app.command('/dstartm', async ({ command, ack, respond }) => {
  await ack();
  
  // Check if the user is authorized
  if (command.user_id !== 'U078PH0GBEH') {
    await respond({
      text: "Sorry! Only deployor can use this command! 🔒",
      response_type: 'ephemeral'
    });
    return;
  }

  const arg = command.text.trim().toLowerCase();
  if (!['on', 'off'].includes(arg)) {
    await respond({
      text: "Please use 'on' or 'off' as the argument. Example: `/dstartm on`",
      response_type: 'ephemeral'
    });
    return;
  }

  try {
    await storage.setItem('startupMessageEnabled', arg === 'on');
    await respond({
      text: `✅ Startup message has been turned ${arg}`,
      response_type: 'ephemeral'
    });
  } catch (error) {
    console.error('Error saving startup message state:', error);
    await respond({
      text: "Sorry, there was an error saving your preference.",
      response_type: 'ephemeral'
    });
  }
});

// DeBot AI chat command
app.command('/dai', async ({ command, ack, respond, client }) => {
  // Immediately acknowledge the command to prevent timeouts
  await ack();

  const message = command.text.trim();
  if (!message) {
    await respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "> Hey!"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Hey there! :yay: How's it going? What's on your mind today? :giggle:"
          }
        }
      ]
    });
    return;
  }

  try {
    // Get user info
    const userInfo = await client.users.info({ user: command.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;
    const userId = command.user_id;
    
    // Let the system determine what's worth remembering
    const memorableDetail = await findMemorableDetails(message);
    if (memorableDetail) {
      await storeUserMemory(userId, memorableDetail, userName);
    }
    
    // Handle any mentioned users in the message
    const mentionedUsers = extractMentionedUsers(message);
    for (const mentionedUser of mentionedUsers) {
      if (mentionedUser !== 'U08FRS21HC6') { // Don't store mentions of the bot itself
        const mentionContext = message.split(new RegExp(`<@${mentionedUser}>`))[1] || message;
        await storeMentionedUserMemory(mentionedUser, mentionContext, userId);
      }
    }
    
    // Use the response_url to send the "thinking" message
    const axios = (await import('axios')).default;
    
    // Send initial "thinking" message via response_url
    await axios.post(command.response_url, {
      response_type: 'in_channel',
      text: "One moment...",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `One moment...`
          }
        }
      ],
      replace_original: false
    });

    // Pass the client instance to chat service for DM capabilities
    const response = await chat(message, userId, userName, client);
    
    // Send the final response
    await axios.post(command.response_url, {
      response_type: 'in_channel',
      text: response,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: response
          }
        }
      ],
      replace_original: true
    });
    
    // Store bot's response if it seems significant
    if (response.length > 20) {
      const responseMemory = `Bot responded to "${message.substring(0, 30)}..." with "${response.substring(0, 30)}..."`;
      await storeUserMemory(userId, responseMemory, userName);
    }
  } catch (error) {
    console.error('Error in /dai command:', error);
    
    // Send error message via response_url
    try {
      const axios = (await import('axios')).default;
      let errorMessage = "Oops! :sad_pepe: My circuits got a bit tangled there! Can we try that again? :prayge:";
      if (error.message === 'Request timed out') {
        errorMessage = "Whoopsie! :orphmoji-scared: I got lost in thought for too long! Let's try that again, shall we? :giggle:";
      }
      
      await axios.post(command.response_url, {
        response_type: 'ephemeral',
        text: errorMessage,
        replace_original: false
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

// Reset DeBot's personality command
app.command('/dreset', async ({ command, ack, respond }) => {
  await ack();
  
  // Check if the user is authorized
  if (command.user_id !== 'U078PH0GBEH') {
    await respond({
      text: "Sorry! Only deployor can use this command! 🔒",
      response_type: 'ephemeral'
    });
    return;
  }

  try {
    const { resetPersonality } = await import('./services/personalityService.js');
    const success = await resetPersonality();
    
    if (success) {
      await respond({
        text: "✨ My personality has been reset to default! I'm feeling fresh and friendly again! :yay:",
        response_type: 'ephemeral'
      });
    } else {
      await respond({
        text: "Oops! Something went wrong while resetting my personality. :sad_pepe:",
        response_type: 'ephemeral'
      });
    }
  } catch (error) {
    console.error('Error resetting personality:', error);
    await respond({
      text: "Sorry, there was an error resetting my personality.",
      response_type: 'ephemeral'
    });
  }
});

// Handle direct mentions and messages containing "DeBot"
app.message(async ({ message, say, client }) => {
  try {
    // Skip if message is from a bot or doesn't have text
    if (message.bot_id || message.subtype === 'bot_message' || !message.text) {
      return;
    }

    // Skip messages in threads that aren't direct mentions
    if (message.thread_ts && !message.text.includes('<@U08FRS21HC6>')) {
      return;
    }
    
    // More robust detection of bot mentions
    const messageText = message.text.toLowerCase();
    const isBotMentioned = 
      message.text.includes('<@U08FRS21HC6>') || // Direct mention by ID
      messageText.includes('debot') || // Name anywhere in message (not just start)
      messageText.includes('<@u08frs21hc6>'); // Case insensitive mention
    
    console.log(`Bot mention check: "${message.text}" - Mentioned: ${isBotMentioned}`);
    
    // Skip if it's not meant for the bot
    if (!isBotMentioned) {
      return;
    }
    
    console.log('Processing message for DeBot');
    
    // Add message ID tracking to prevent duplicate responses
    // Use a combination of timestamp and channel to create a unique ID
    const messageId = `${message.ts}-${message.channel}`;
    
    // Check if we've already processed this message
    const processedMessages = global.processedMessages || new Set();
    if (processedMessages.has(messageId)) {
      console.log(`Already processed message ${messageId}, skipping`);
      return;
    }
    
    // Mark this message as processed
    processedMessages.add(messageId);
    
    // Keep the set to a reasonable size by removing old entries
    if (processedMessages.size > 100) {
      const oldestEntries = Array.from(processedMessages).slice(0, 10);
      oldestEntries.forEach(entry => processedMessages.delete(entry));
    }
    
    // Make the set available globally
    global.processedMessages = processedMessages;
    
    // Get user info
    const userInfo = await client.users.info({ user: message.user });
    const userName = userInfo.user.real_name || userInfo.user.name;
    const userId = message.user;
    
    // Remove the bot mention from the message
    let userMessage = message.text
      .replace(/<@U08FRS21HC6>/gi, '') // Case insensitive replacement
      .replace(/debot/gi, '')
      .trim();
    
    if (!userMessage) {
      await say({
        text: "Hey there! :yay: How's it going? What's on your mind today? :giggle:",
        thread_ts: message.thread_ts
      });
      return;
    }
    
    // Protection against malicious pings
    // Count mentions in the original message
    const mentionCount = (message.text.match(/<@[A-Z0-9]+>/g) || []).length;
    
    // If there are too many mentions, don't include them in the context
    const mentionedUsers = mentionCount > 3 
      ? [] // Skip mentions if there are too many (likely spam)
      : extractMentionedUsers(userMessage);
    
    // Let the system determine what's worth remembering
    const memorableDetail = await findMemorableDetails(userMessage);
    if (memorableDetail) {
      await storeUserMemory(userId, memorableDetail, userName);
      console.log(`Stored memory for ${userName}: ${memorableDetail}`);
    }
    
    // Handle mentioned users in the message (with protection)
    if (mentionCount <= 3) {  // Only process if mentions are reasonable
      for (const mentionedUser of mentionedUsers) {
        if (mentionedUser !== 'U08FRS21HC6') { // Don't store mentions of the bot itself
          const mentionContext = userMessage.split(new RegExp(`<@${mentionedUser}>`, 'i'))[1] || userMessage;
          await storeMentionedUserMemory(mentionedUser, mentionContext, userId);
        }
      }
    }

    console.log('Sending thinking message');
    // Send initial "thinking" message
    const thinkingMessage = await client.chat.postMessage({
      channel: message.channel,
      text: "One moment...",
      thread_ts: message.thread_ts
    });

    console.log('Getting response from chat service');
    // Get response from chat service with user context
    const response = await chat(userMessage, userId, userName, client);

    console.log('Updating with final response');
    // Replace the "thinking" message with the actual response
    await client.chat.update({
      channel: message.channel,
      ts: thinkingMessage.ts,
      text: response
    });
    
    // Store bot's response in a smart way - only if it contains meaningful information
    const responseWords = response.split(/\s+/).length;
    if (responseWords > 5 && response.length > 20) {
      // Create a summarized version of the conversation for memory
      const conversationSummary = `User asked: "${userMessage.length > 30 ? userMessage.substring(0, 30) + '...' : userMessage}" → Bot answered about ${getTopicFromMessage(userMessage)}`;
      await storeUserMemory(userId, conversationSummary, userName);
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    try {
      let errorMessage = "Oops! :sad_pepe: My circuits got a bit tangled there! Can we try that again? :prayge:";
      if (error.message === 'Request timed out') {
        errorMessage = "Whoopsie! :orphmoji-scared: I got lost in thought for too long! Let's try that again, shall we? :giggle:";
      }
      
      await client.chat.postMessage({
        channel: message.channel,
        text: errorMessage,
        thread_ts: message.thread_ts
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

/**
 * Extract a topic from a user message for memory summarization
 * @param {string} message - User message
 * @returns {string} Topic of the conversation
 */
function getTopicFromMessage(message) {
  // Extract key nouns or phrases
  const topics = [
    { keywords: ['help', 'assistance', 'support'], topic: 'getting help' },
    { keywords: ['code', 'programming', 'developer', 'coding'], topic: 'programming' },
    { keywords: ['javascript', 'js', 'nodejs', 'node.js'], topic: 'JavaScript' },
    { keywords: ['python', 'django', 'flask'], topic: 'Python' },
    { keywords: ['web', 'html', 'css'], topic: 'web development' },
    { keywords: ['database', 'sql', 'mongodb', 'postgres'], topic: 'databases' },
    { keywords: ['deploy', 'server', 'hosting', 'cloud'], topic: 'deployment' },
    { keywords: ['error', 'bug', 'fix', 'issue'], topic: 'troubleshooting' },
    { keywords: ['git', 'github', 'version', 'commit'], topic: 'version control' },
    { keywords: ['api', 'endpoint', 'rest', 'graphql'], topic: 'APIs' },
    { keywords: ['security', 'auth', 'authentication'], topic: 'security' },
    { keywords: ['test', 'testing', 'unit test'], topic: 'testing' },
    { keywords: ['docker', 'container', 'kubernetes'], topic: 'containerization' },
    { keywords: ['ai', 'ml', 'machine learning'], topic: 'AI/ML' },
    { keywords: ['design', 'ui', 'ux', 'user interface'], topic: 'design' },
    { keywords: ['agile', 'scrum', 'project'], topic: 'project management' }
  ];
  
  const lowercaseMessage = message.toLowerCase();
  
  for (const item of topics) {
    for (const keyword of item.keywords) {
      if (lowercaseMessage.includes(keyword)) {
        return item.topic;
      }
    }
  }
  
  // Default topic if no keywords match
  return "that topic";
}

// Start the app
(async () => {
  try {
    // Ensure storage is initialized with a default value if not set
    const currentSetting = await storage.getItem('startupMessageEnabled');
    if (currentSetting === undefined) {
      await storage.setItem('startupMessageEnabled', true);
    }
    // Start the app
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ DeBot is alive and ready to help!');
    console.log(`🚀 HTTP server is running on port ${process.env.PORT || 3000}`);
    // Send welcome message when bot starts
    await sendWelcomeMessage();
  } catch (error) {
    console.error('Error starting DeBot:', error);
    process.exit(1);
  }
})(); // Added missing closing parenthesis