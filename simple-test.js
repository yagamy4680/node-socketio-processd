const io = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

async function simpleTest() {
  console.log('Starting a simple test...');
  
  // Start the server
  const serverPath = path.join(__dirname, 'src', 'index.js');
  console.log('Starting server with command:', `node ${serverPath} --verbose --line --port 9001 -- echo "Hello World"`);
  
  const serverProcess = spawn('node', [serverPath, '--verbose', '--line', '--port', '9001', '--', 'echo', 'Hello World'], {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('Connecting client...');
  const client = io('http://localhost:9001');
  
  let events = [];
  
  client.on('connect', () => {
    console.log('✅ Client connected');
    events.push('connect');
  });

  client.on('child-info', (data) => {
    console.log('✅ Received child-info:', data);
    events.push('child-info');
  });

  client.on('child-stdout-line', (data) => {
    console.log('✅ Received stdout-line:', data);
    events.push('child-stdout-line');
  });

  client.on('child-exit', (data) => {
    console.log('✅ Received child-exit:', data);
    events.push('child-exit');
  });

  // Wait for events
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('Events received:', events);
  
  client.disconnect();
  serverProcess.kill('SIGTERM');
  
  process.exit(events.includes('child-info') && events.includes('child-stdout-line') && events.includes('child-exit') ? 0 : 1);
}

simpleTest().catch(console.error);