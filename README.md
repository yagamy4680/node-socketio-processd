# node-socketio-processd

A command-line tool that wraps existing CLI programs and allows access via Socket.IO. This enables you to run command-line programs on a server and interact with them from a web browser or any other Socket.IO client.

## Installation

```bash
npm install
```

For global installation:
```bash
npm install -g .
```

## Usage

```bash
node-socketio-processd [options] -- <command> [args...]
```

### Options

- `--port` or `-p`: Port number for the Socket.IO server (default: 3000)
- `--verbose` or `-v`: Enable verbose logging (default: false)
- `--wait` or `-w`: Wait for a client to connect before starting the child process (default: false)
- `--restart` or `-r`: Automatically restart the child process if it exits (default: false)
- `--line` or `-l`: Line mode - treat output as plain text lines instead of binary data (default: false)

### Examples

```bash
# Basic usage - run echo command
node-socketio-processd -- echo "Hello World"

# Run with custom port and verbose logging
node-socketio-processd --port 4000 --verbose -- my-command --arg1 value1

# Wait for client before starting and auto-restart on exit
node-socketio-processd --wait --restart -- node server.js

# Line mode for text-based output
node-socketio-processd --line -- tail -f /var/log/system.log
```

## Socket.IO Events

### Server to Client Events

#### RAW Mode (default)
- `child-stdout`: Emitted when the child process writes to STDOUT
  - Data: `{ time: number, data: Buffer }`
- `child-stderr`: Emitted when the child process writes to STDERR
  - Data: `{ time: number, data: Buffer }`

#### LINE Mode (--line option)
- `child-stdout-line`: Emitted for each line of STDOUT output
  - Data: `{ time: number, line: string }`
- `child-stderr-line`: Emitted for each line of STDERR output
  - Data: `{ time: number, line: string }`

#### Common Events
- `child-exit`: Emitted when the child process exits
  - Data: `{ code: number, signal: string }`
- `child-info`: Emitted when a client connects
  - Data: `{ pid: number, command: string }`
- `child-restart`: Emitted when the child process is restarted
  - Data: `{ pid: number, command: string }`

### Client to Server Events

- `child-stdin`: Send input to the child process
  - Data: Buffer or string
- `request-restart`: Request manual restart of the child process (when --restart is enabled)

## Client Example

```javascript
const io = require('socket.io-client');
const client = io('http://localhost:3000');

client.on('connect', () => {
  console.log('Connected to server');
});

client.on('child-stdout-line', (data) => {
  console.log(`[${new Date(data.time).toISOString()}] ${data.line}`);
});

client.on('child-stderr-line', (data) => {
  console.error(`[${new Date(data.time).toISOString()}] ${data.line}`);
});

client.on('child-exit', (data) => {
  console.log(`Process exited with code ${data.code}`);
});

// Send input to the process
client.emit('child-stdin', 'some input\n');

// Request restart (if --restart option is enabled)
client.emit('request-restart');
```

## Logging

### Verbose Mode (--verbose)
- In LINE mode: Logs each line with timestamp and color coding (blue for STDOUT, magenta for STDERR)
- In RAW mode: Logs data as hex with timestamp and color coding

### Non-Verbose Mode
- Logs byte counts for STDOUT and STDERR periodically (default: every 1 second)
- Period can be adjusted with `LOG_INTERVAL_MS` environment variable

## Features

- **Multiple Clients**: Supports multiple Socket.IO clients connected simultaneously
- **Process Management**: Handles process lifecycle, exit codes, and signals
- **Auto-restart**: Optional automatic restart of child processes
- **Wait Mode**: Option to wait for client connection before starting process
- **Flexible Output**: Both raw binary and line-based text output modes
- **Input Support**: Send input to child process via Socket.IO
- **Graceful Shutdown**: Handles SIGINT/SIGTERM and properly terminates child processes

## Graceful Shutdown

When the tool receives a SIGINT (Ctrl+C) or SIGTERM signal, it performs a graceful shutdown:

1. **Graceful Termination**: Sends SIGTERM to the child process for graceful shutdown
2. **Wait Period**: Waits up to 5 seconds for the child process to exit cleanly  
3. **Force Kill**: If the child process doesn't exit within 5 seconds, sends SIGKILL to force termination
4. **Server Cleanup**: Closes the Socket.IO server and exits the main process

This ensures that:
- Child processes have a chance to clean up resources
- Long-running processes are not left orphaned
- The tool exits cleanly in all scenarios
- No zombie processes are left behind

## Testing

Run the test suite:

```bash
npm test
```

The tests verify:
- Server startup and client connections
- Child process stdout/stderr events
- Process info and exit events
- Stdin functionality
- Wait option behavior

## Environment Variables

- `LOG_INTERVAL_MS`: Interval for logging byte counts in non-verbose mode (default: 1000ms)

## Requirements

- Node.js >= 14.0.0
- Dependencies: express, socket.io, yargs, colors
- Dev dependencies: socket.io-client (for testing)