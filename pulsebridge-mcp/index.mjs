#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const BRIDGE_URL = process.env.PULSEBRIDGE_URL || 'http://127.0.0.1:8080'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolveAuthToken() {
  if (process.env.PULSEBRIDGE_TOKEN) {
    return process.env.PULSEBRIDGE_TOKEN.trim()
  }
  try {
    const tokenFile = path.join(os.tmpdir(), 'pulsebridge_tokens.json')
    if (fs.existsSync(tokenFile)) {
      const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[parsed.length - 1]
      }
    }
  } catch (_) {}
  return ''
}

function getAuthHeaders() {
  const token = resolveAuthToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

const server = new Server(
  {
    name: 'pulsebridge-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'notify_phone',
        description: 'Sends a high-priority notification or question directly to the user phone dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Notification title' },
            message: { type: 'string', description: 'Message or question for the user' },
            level: {
              type: 'string',
              enum: ['info', 'success', 'warning', 'error'],
              description: 'Alert urgency level',
            },
          },
          required: ['title', 'message'],
        },
      },
      {
        name: 'update_task_status',
        description: 'Updates task title, progress percentage, and milestone checklist shown on the user phone',
        inputSchema: {
          type: 'object',
          properties: {
            task_title: { type: 'string', description: 'High-level task or objective name' },
            current_step: { type: 'string', description: 'Short summary of the step currently running' },
            percent_complete: { type: 'number', description: 'Completion percentage (0 to 100)' },
            status: {
              type: 'string',
              enum: ['thinking', 'runningtool', 'waitinginput', 'completed', 'failed'],
            },
          },
          required: ['task_title'],
        },
      },
      {
        name: 'ask_phone',
        description: 'Sends an interactive question with clickable decision buttons (e.g. ["Proceed", "Abort", "Review"]) to the user mobile dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question or choice to present to the user' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of quick-tap button choices, e.g. ["Deploy to Production", "Run Tests First", "Cancel"]',
            },
            level: {
              type: 'string',
              enum: ['info', 'warning', 'critical'],
              description: 'Notification urgency level',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'check_phone_inbox',
        description: 'Checks if the user has sent any instructions, answers, or corrections from their phone',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'notify_phone') {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/ingest/event`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ide: 'antigravity',
          event_type: 'alert',
          content: args.message,
          task_title: args.title,
          status: args.level || 'info',
        }),
      })

      if (res.ok) {
        return {
          content: [{ type: 'text', text: `Successfully sent alert to phone: "${args.title}"` }],
        }
      } else {
        return {
          content: [{ type: 'text', text: `Bridge responded with status ${res.status}` }],
          isError: true,
        }
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to reach PulseBridge server at ${BRIDGE_URL}: ${err.message}` }],
        isError: true,
      }
    }
  }

  if (name === 'update_task_status') {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/ingest/event`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ide: 'antigravity',
          event_type: 'status',
          task_title: args.task_title,
          content: args.current_step,
          percent_complete: args.percent_complete,
          status: args.status,
        }),
      })

      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `Bridge rejected status update with HTTP ${res.status}` }],
          isError: true,
        }
      }

      return {
        content: [{ type: 'text', text: `Task progress updated on phone (${args.percent_complete ?? 50}%).` }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating task progress: ${err.message}` }],
        isError: true,
      }
    }
  }

  if (name === 'ask_phone') {
    try {
      const options =
        Array.isArray(args.options) && args.options.length > 0 ? args.options : ['Approve', 'Reject']
      const optionsTag = `\n[OPTIONS: ${options.join(' | ')}]`
      const fullMessage = `${args.question}${optionsTag}`
      const headers = getAuthHeaders()

      // Post chat event step
      const stepRes = await fetch(`${BRIDGE_URL}/api/ingest/event`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ide: 'antigravity',
          event_type: 'step',
          step_type: 'ASK_QUESTION',
          content: fullMessage,
          status: 'RUNNING',
          tool_calls: [
            {
              tool_name: 'ask_phone',
              action: JSON.stringify({ question: args.question, options }),
              summary: 'Waiting for phone decision',
            },
          ],
        }),
      })

      if (!stepRes.ok) {
        return {
          content: [{ type: 'text', text: `Bridge rejected ask_phone step with HTTP ${stepRes.status}` }],
          isError: true,
        }
      }

      // Also trigger a high-priority alert chime on the phone
      await fetch(`${BRIDGE_URL}/api/ingest/event`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ide: 'antigravity',
          event_type: 'alert',
          content: args.question,
          task_title: 'Decision Required from Phone',
          status: args.level === 'critical' ? 'error' : 'warning',
        }),
      })

      return {
        content: [
          {
            type: 'text',
            text: `Decision prompt dispatched to phone with options: [${options.join(
              ', '
            )}]. Check phone inbox for user response using check_phone_inbox.`,
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to prompt phone: ${err.message}` }],
        isError: true,
      }
    }
  }

  if (name === 'check_phone_inbox') {
    try {
      const messages = []

      // 1. Query live authenticated in-memory inbox queue on PulseBridge server
      try {
        const res = await fetch(`${BRIDGE_URL}/api/inbox?unread_only=true&ack=true`, {
          method: 'GET',
          headers: getAuthHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            for (const m of data.messages) {
              messages.push({
                source: 'pulsebridge_live_inbox',
                id: m.id,
                timestamp: m.timestamp,
                ide: m.target_ide,
                project_name: m.project_name,
                conversation_id: m.conversation_id,
                prompt: m.message,
              })
            }
          }
        }
      } catch (_) {}

      // 2. Fallback to file-based inbox if live server queue had no unread items
      if (messages.length === 0) {
        const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default'
        const brainInbox = path.join(userProfile, '.gemini', 'antigravity', 'brain', 'forge-inbox')
        const baseDir = process.env.PULSEBRIDGE_DIR || path.resolve(__dirname, '..')
        const localInbox = path.join(baseDir, '.inbox', 'latest_prompt.txt')

        if (fs.existsSync(localInbox)) {
          const text = fs.readFileSync(localInbox, 'utf8').trim()
          if (text) {
            messages.push({ source: 'phone_quick_prompt', text })
          }
        }

        if (fs.existsSync(brainInbox)) {
          const files = fs.readdirSync(brainInbox).filter((f) => f.endsWith('.json')).sort().slice(-10)
          for (const file of files) {
            try {
              const content = JSON.parse(fs.readFileSync(path.join(brainInbox, file), 'utf8'))
              messages.push(content)
            } catch (_) {}
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text:
              messages.length > 0
                ? JSON.stringify(messages, null, 2)
                : 'No pending messages from phone. User has not submitted new instructions.',
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error reading phone inbox: ${err.message}` }],
        isError: true,
      }
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  }
})

async function run() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('PulseBridge MCP server running on stdio')
}

run().catch((err) => {
  console.error('Fatal MCP error:', err)
  process.exit(1)
})
