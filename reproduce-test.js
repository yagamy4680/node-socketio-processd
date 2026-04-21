const io = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

// Reproduce the exact test scenario that's failing
async function reproduceTest() {
  console.log('🔍 Reproducing exact test scenario...');
  
  const serverPath = path.join(__dirname, 'src', 'index.js');
  console.log('Starting server:', `node ${serverPath} --port 3002 --line -- echo "Hello World"`);
  
  const serverProcess = spawn('node', [serverPath, '--port', '3002', '--line', '--', 'echo', 'Hello World'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverReady = false;
  let output = '';

  const serverPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!serverReady) {
        serverProcess.kill('SIGKILL');
        reject(new Error(`Server did not start within 5000ms. Output: ${output}`));
      }
    }, 5000);

    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('Server stdout:', data.toString().trim());
      if (data.toString().includes('Socket.IO server listening')) {
        serverReady = true;
        clearTimeout(timer);
        resolve(serverProcess);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      output += data.toString();
      console.log('Server stderr:', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      if (!serverReady) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });
  });

  try {
    await serverPromise;
    console.log('✅ Server started successfully');
    
    // Now try to connect
    console.log('Connecting client...');
    
    const clientPromise = new Promise((resolve, reject) => {
      const client = io('http://localhost:3002');
      
      // Set up event listeners BEFORE connecting
      let events = [];
      
      client.on('child-info', (data) => {
        console.log('✅ child-info:', data);
        events.push('child-info');
      });

      client.on('child-stdout-line', (data) => {
        console.log('✅ child-stdout-line:', data);
        events.push('child-stdout-line');
      });

      client.on('child-exit', (data) => {
        console.log('✅ child-exit:', data);
        events.push('child-exit');
      });
      
      client.on('connect', () => {
        console.log('✅ Client connected');
        resolve({ client, events });
      });

      client.on('connect_error', (error) => {
        console.log('❌ Client connection error:', error.message);
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Client connection timeout'));
      }, 3000);
    });
    
    const { client, events } = await clientPromise;
    
    // Wait for events (they should be replayed immediately on connection)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('Final events received:', events);
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
    
    const hasAllEvents = events.includes('child-info') && 
                        events.includes('child-stdout-line') && 
                        events.includes('child-exit');
    
    console.log(hasAllEvents ? '✅ All events received!' : '❌ Missing events');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    serverProcess.kill('SIGKILL');
  }
}

reproduceTest();