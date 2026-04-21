const io = require('socket.io-client');

async function debugTest() {
  console.log('Connecting to server...');
  
  const client = io('http://localhost:8001');
  
  client.on('connect', () => {
    console.log('✅ Connected to server');
  });

  client.on('child-info', (data) => {
    console.log('✅ Received child-info:', data);
  });

  client.on('child-stdout-line', (data) => {
    console.log('✅ Received stdout line:', data);
  });

  client.on('child-stderr-line', (data) => {
    console.log('✅ Received stderr line:', data);
  });

  client.on('child-exit', (data) => {
    console.log('✅ Received child-exit:', data);
    process.exit(0);
  });

  client.on('connect_error', (error) => {
    console.log('❌ Connection error:', error);
    process.exit(1);
  });

  // Timeout after 10 seconds
  setTimeout(() => {
    console.log('❌ Timeout - disconnecting');
    client.disconnect();
    process.exit(1);
  }, 10000);
}

debugTest();