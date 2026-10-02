import * as vscode from 'vscode'

const BRIDGE_URL = 'http://127.0.0.1:8080'

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(device-mobile) PulseBridge'
  statusBar.tooltip = 'Click to open PulseBridge Phone Companion Pairing'
  statusBar.command = 'pulsebridge.openDashboard'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // Track active file save events and report to phone
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    const filename = doc.fileName.split(/[\\/]/).pop() || doc.fileName
    reportEvent({
      ide: 'vscode',
      event_type: 'step',
      tool_name: 'file_save',
      tool_action: `Saved file: ${filename}`,
      content: `User or agent modified and saved ${filename}`,
      status: 'DONE',
    })
  })
  context.subscriptions.push(saveListener)

  // Register commands
  const openCmd = vscode.commands.registerCommand('pulsebridge.openDashboard', () => {
    vscode.env.openExternal(vscode.Uri.parse(BRIDGE_URL))
  })
  context.subscriptions.push(openCmd)

  const syncCmd = vscode.commands.registerCommand('pulsebridge.syncNow', () => {
    const workspaceName = vscode.workspace.name || 'Untitled Workspace'
    reportEvent({
      ide: 'vscode',
      event_type: 'status',
      task_title: `Workspace: ${workspaceName}`,
      content: `Active editor: ${vscode.window.activeTextEditor?.document.fileName || 'None'}`,
      percent_complete: 50,
      status: 'waitinginput',
    })
    vscode.window.showInformationMessage('PulseBridge: Workspace state synced to phone companion!')
  })
  context.subscriptions.push(syncCmd)
}

export function deactivate() {}

async function reportEvent(payload: Record<string, any>) {
  try {
    await fetch(`${BRIDGE_URL}/api/ingest/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (_) {
    // Bridge might not be running yet
  }
}
