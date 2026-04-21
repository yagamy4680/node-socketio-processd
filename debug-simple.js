const io = require('socket.io-client');
const { spawn } = require('child_process');

async function debugTest() {
  console.log('🔍 Starting debug test...');
  
  // Start server
  console.log('Starting server...');
  const server = spawn('node', ['src/index.js', '--line', '--port', '9999', '--', 'echo', 'Hello World']);
  
  server.stdout.on('data', (data) => {
    console.log('Server output:', data.toString());
  });
  
  server.stderr.on('data', (data) => {
    console.log('Server error:', data.toString());
  });
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('Connecting client...');
  const client = io('http://localhost:9999');
  
  let eventsReceived = [];
  
  client.on('connect', () => {
    console.log('✅ Connected');
    eventsReceived.push('connect');
  });

  client.on('child-info', (data) => {
    console.log('✅ child-info:', data);
    eventsReceived.push('child-info');
  });

  client.on('child-stdout-line', (data) => {
    console.log('✅ child-stdout-line:', data);
    eventsReceived.push('child-stdout-line');
  });

  client.on('child-exit', (data) => {
    console.log('✅ child-exit:', data);
    eventsReceived.push('child-exit');
  });

  client.on('connect_error', (error) => {
    console.log('❌ Connection error:', error.message);
  });

  // Wait and see what we get
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('Events received:', eventsReceived);
  
  client.disconnect();
  server.kill('SIGTERM');
  
  // Exit with success if we got the main events
  const success = eventsReceived.includes('child-info') && 
                  eventsReceived.includes('child-stdout-line') && 
                  eventsReceived.includes('child-exit');
  
  console.log(success ? '✅ Test passed!' : '❌ Test failed');
  process.exit(success ? 0 : 1);
}

debugTest().catch(console.error);