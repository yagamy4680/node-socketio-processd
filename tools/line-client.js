#!/usr/bin/env node

const io = require('socket.io-client');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const colors = require('colors');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <url>')
  .positional('url', {
    describe: 'Socket.IO server URL (e.g., http://127.0.0.1:8000)',
    type: 'string'
  })
  .example('$0 http://127.0.0.1:8000', 'Connect to server at localhost:8000')
  .example('$0 http://localhost:3000', 'Connect to server at localhost:3000')
  .help('h')
  .alias('h', 'help')
  .demandCommand(1, 'You must provide a server URL')
  .argv;

const serverUrl = argv._[0];

console.log(`🔌 Connecting to Socket.IO server: ${serverUrl}`.cyan);

const client = io(serverUrl);

let connected = false;

// Connection events
client.on('connect', () => {
  connected = true;
  console.log(`✅ Connected to server (${client.id})`.green);
});

client.on('connect_error', (error) => {
  console.log(`❌ Connection error: ${error.message}`.red);
  process.exit(1);
});

client.on('disconnect', (reason) => {
  console.log(`🔌 Disconnected: ${reason}`.yellow);
  if (connected) {
    process.exit(0);
  }
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

client.on('child-restart', (data) => {
  console.log(`🔄 Process restarted: PID=${data.pid}, Command="${data.command}"`.magenta);
});

// Handle any other events generically
const originalOn = client.on.bind(client);
client.on = function(event, handler) {
  // Don't double-bind events we already handle
  const handledEvents = ['connect', 'connect_error', 'disconnect', 'child-info', 'child-stdout', 'child-stdout-line', 'child-stderr', 'child-stderr-line', 'child-exit', 'child-restart'];
  
  if (!handledEvents.includes(event)) {
    const wrappedHandler = (...args) => {
      console.log(`📡 Event '${event}':`.gray, args);
      return handler(...args);
    };
    return originalOn(event, wrappedHandler);
  }
  
  return originalOn(event, handler);
};

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