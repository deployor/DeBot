export async function handlePrinterWebhook(data, app) {
  // Only process if it's a failure warning
  if (data.EventType !== 'Gadget Possible Failure Warning') {
    return;
  }

  // Verify secret key if configured
  if (process.env.OCTOEVERYWHERE_SECRET_KEY && 
      data.SecretKey !== process.env.OCTOEVERYWHERE_SECRET_KEY) {
    console.error('Invalid secret key received');
    return;
  }

  const issueTypes = analyzeIssues(data);
  if (issueTypes.length > 0) {
    await sendSlackAlert(app, data, issueTypes);
  }
}

function analyzeIssues(data) {
  const issues = [];
  
  // Analyze potential issues based on available data
  if (data.Error) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `🚫 Error detected: ${data.Error}`,
      tips: getErrorTips(data.Error)
    });
  }

  // Add specific issue detection logic
  if (data.ZOffsetMM !== undefined) {
    const zOffset = parseFloat(data.ZOffsetMM);
    if (Math.abs(zOffset) > 0.5) {
      issues.push({
        type: 'z-offset',
        severity: 'medium',
        message: `⚠️ Significant Z-offset detected (${zOffset}mm)`,
        tips: [
          "Consider checking bed leveling",
          "Verify first layer adhesion",
          "Monitor initial layer height"
        ]
      });
    }
  }

  return issues;
}

function getErrorTips(error) {
  // Common 3D printing error tips
  const errorTips = {
    'layer shift': [
      "Check belt tension",
      "Verify stepper motor connections",
      "Ensure print bed is stable"
    ],
    'under': [
      "Check filament feed rate",
      "Verify nozzle temperature",
      "Clean the nozzle"
    ],
    'adhesion': [
      "Clean the print bed",
      "Adjust bed temperature",
      "Check first layer settings"
    ]
  };

  // Find matching tips or return general tips
  for (const [key, tips] of Object.entries(errorTips)) {
    if (error.toLowerCase().includes(key)) {
      return tips;
    }
  }

  return [
    "Monitor print progress closely",
    "Check mechanical components",
    "Verify temperature settings"
  ];
}

async function sendSlackAlert(app, data, issues) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚨 3D Printer Alert! Time to Check Your Print!",
        emoji: true
      }
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Printer:*\n${data.PrinterName}`
        },
        {
          type: "mrkdwn",
          text: `*File:*\n${data.FileName || 'N/A'}`
        },
        {
          type: "mrkdwn",
          text: `*Progress:*\n${data.Progress}%`
        },
        {
          type: "mrkdwn",
          text: `*Time Remaining:*\n${formatTime(data.TimeRemainingSec)}`
        }
      ]
    }
  ];

  // Add each issue with its tips
  issues.forEach(issue => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${issue.message}*${issue.severity === 'high' ? ' 🔥' : ''}`
      }
    });

    if (issue.tips && issue.tips.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "💡 *Quick Tips:*\n" + issue.tips.map(tip => `• ${tip}`).join('\n')
        }
      });
    }
  });

  // Add quick view link if available
  if (data.QuickViewUrl) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "👀 *Need a closer look?*"
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Check Printer Status",
          emoji: true
        },
        url: data.QuickViewUrl,
        action_id: "check_printer"
      }
    });
  }

  // Add snapshot if available
  if (data.SnapshotUrl) {
    blocks.push({
      type: "image",
      title: {
        type: "plain_text",
        text: "Current Print Status",
        emoji: true
      },
      image_url: data.SnapshotUrl,
      alt_text: "3D print snapshot"
    });
  }

  // Add footer with help text
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "💪 *Remember:* Catching issues early means better prints! Keep an eye on those layers!"
      }
    ]
  });

  try {
    await app.client.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      blocks: blocks,
      text: "3D Printer Alert: Potential issue detected!" // Fallback text
    });
  } catch (error) {
    console.error('Error sending Slack message:', error);
  }
}

function formatTime(seconds) {
  if (!seconds) return 'N/A';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
}