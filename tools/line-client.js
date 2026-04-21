#!/usr/bin/env node

const io = require('socket.io-client');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const colors = require('colors');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options] <url>')
  .positional('url', {
    describe: 'Socket.IO server URL (e.g., http://127.0.0.1:8000)',
    type: 'string'
  })
  .option('mode', {
    alias: 'm',
    type: 'string',
    choices: ['commander', 'monitor'],
    default: 'monitor',
    describe: 'Client mode: commander (full control, single client) or monitor (read-only, multiple clients)'
  })
  .example('$0 http://127.0.0.1:8000', 'Connect as monitor to localhost:8000')
  .example('$0 --mode commander http://127.0.0.1:8000', 'Connect as commander to localhost:8000')
  .example('$0 -m monitor http://localhost:3000', 'Connect as monitor to localhost:3000')
  .help('h')
  .alias('h', 'help')
  .demandCommand(1, 'You must provide a server URL')
  .argv;

const serverUrl = argv._[0];
const mode = argv.mode;
const namespace = mode === 'commander' ? '/commander' : '/monitor';

console.log(`🔌 Connecting to Socket.IO server: ${serverUrl}${namespace} (${mode} mode)`.cyan);

const client = io(`${serverUrl}${namespace}`);

let connected = false;

// Connection events
client.on('connect', () => {
  connected = true;
  console.log(`✅ Connected to server (${client.id}) as ${mode}`.green);
});

client.on('connect_error', (error) => {
  console.log(`❌ Connection error: ${error.message}`.red);
  process.exit(1);
});

client.on('connection-rejected', (data) => {
  console.log(`❌ Connection rejected: ${data.reason}`.red);
  process.exit(1);
});

client.on('disconnect', (reason) => {
  console.log(`🔌 Disconnected: ${reason}`.yellow);
  if (connected) {
    process.exit(0);
  }
});

client.on('error', (error) => {
  console.log(`⚠️  Server error: ${error.message}`.yellow);
});

// Child process events
client.on('child-info', (data) => {
  console.log(`📋 Process Info: PID=${data.pid}, Command="${data.command}"`.blue);
});

client.on('child-stdout', (data) => {
  const timestamp = new Date(data.time).toISOString();
  console.log(`[${timestamp}] 📤 STDOUT (${data.data.length} bytes):`.green);
  console.log(data.data.toString());
});

client.on('child-stdout-line', (data) => {
  const timestamp = new Date(data.time).toISOString();
  console.log(`[${timestamp}] 📤 STDOUT: ${data.line}`.green);
});

client.on('child-stderr', (data) => {
  const timestamp = new Date(data.time).toISOString();
  console.log(`[${timestamp}] 📥 STDERR (${data.data.length} bytes):`.red);
  console.log(data.data.toString());
});

client.on('child-stderr-line', (data) => {
  const timestamp = new Date(data.time).toISOString();
  console.log(`[${timestamp}] 📥 STDERR: ${data.line}`.red);
});

client.on('child-exit', (data) => {
  console.log(`🏁 Process exited with code ${data.code}${data.signal ? `, signal: ${data.signal}` : ''}`.yellow);
  console.log('👋 Exiting client due to child process exit...'.cyan);
  client.disconnect();
  process.exit(data.code || 0);
});

// Handle any other events generically
const originalOn = client.on.bind(client);
client.on = function(event, handler) {
  // Don't double-bind events we already handle
  const handledEvents = ['connect', 'connect_error', 'connection-rejected', 'disconnect', 'error', 'child-info', 'child-stdout', 'child-stdout-line', 'child-stderr', 'child-stderr-line', 'child-exit'];
  
  if (!handledEvents.includes(event)) {
    const wrappedHandler = (...args) => {
      console.log(`📡 Event '${event}':`.gray, args);
      return handler(...args);
    };
    return originalOn(event, wrappedHandler);
  }
  
  return originalOn(event, handler);
};

// If commander mode, show additional message about stdin capability
if (mode === 'commander') {
  console.log('📝 Commander mode: You have full control over the process'.green);
  console.log('ℹ️  Note: This tool currently only displays output. Use a custom client for stdin input.'.gray);
} else {
  console.log('👀 Monitor mode: Read-only access to process output'.blue);
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT (Ctrl+C), disconnecting...'.yellow);
  if (client.connected) {
    client.disconnect();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, disconnecting...'.yellow);
  if (client.connected) {
    client.disconnect();
  }
  process.exit(0);
});

// Handle connection timeout
setTimeout(() => {
  if (!connected) {
    console.log('⏰ Connection timeout after 10 seconds'.red);
    process.exit(1);
  }
}, 10000);

console.log('Press Ctrl+C to exit'.gray);