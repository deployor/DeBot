# 🤖 DeBot

Hey! This is DeBot - a cool Slack bot that helps with 3D printing, commit messages, and debugging. Built for the Hack Club community!

## 🎯 What's DeBot?

It's one bot that does three awesome things:
- 🖨️ Watches your 3D prints for problems
- 💻 Makes your commit messages way better
- 🔍 Helps fix coding errors
- 🧹 Cleans up channel messages

## 🚀 Quick Start

1. You'll need:
   - Node.js
   - A Slack workspace
   - OctoEverywhere account (for 3D printing stuff)

2. Get it running:
```bash
git clone https://github.com/yourusername/debot.git
cd debot
npm install
cp example.env .env
```

3. Fill in your `.env` file:
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
PORT=3000
OCTOEVERYWHERE_SECRET_KEY=your-secret-key
SLACK_CHANNEL_ID=your-channel-id
```

4. Start it up:
```bash
npm start
```

## 💡 How to Use

### For 3D Printing
Just hook up OctoEverywhere to send webhooks to: `https://your-server.com/printer-webhook`
DeBot will let you know if something looks wrong with your print!

### For Better Commits
```
/commiti fix login bug
```
DeBot will suggest something better!

### For Error Help
```
ELLAB: your error message here
```
DeBot will explain what's wrong and how to fix it.

### For Channel Cleanup
```
/purgeee [number]
```
DeBot will delete the specified number of recent messages (defaults to 10).

## 🔧 Setting Up Slack

1. Make a new Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Give it these permissions:
   - chat:write
   - commands
   - app_mentions:read
   - channels:history
   - chat:write:customize
   - groups:history
   - chat:delete
3. Add these slash commands:
   - `/commiti`
   - `/purgeee`
4. Set up your Request URL (where your bot is hosted) in the app settings
5. Install to your workspace

## 👋 Contributing

Got ideas? Want to help? Just fork it and make a PR!

## 📝 License

MIT License - do whatever you want with it!

## 🙏 Thanks

- Hack Club for the AI magic
- OctoEverywhere team
- Made by Deployor