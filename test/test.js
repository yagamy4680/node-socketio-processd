const io = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

class TestRunner {
  constructor() {
    this.tests = [];
    this.results = [];
  }

  addTest(name, testFn) {
    this.tests.push({ name, testFn });
  }

  async runTests() {
    console.log(`Running ${this.tests.length} tests...\n`);
    
    for (const test of this.tests) {
      console.log(`🧪 ${test.name}`);
      try {
        await test.testFn();
        console.log(`✅ ${test.name} - PASSED\n`);
        this.results.push({ name: test.name, status: 'PASSED' });
      } catch (error) {
        console.log(`❌ ${test.name} - FAILED`);
        console.log(`   Error: ${error.message}\n`);
        this.results.push({ name: test.name, status: 'FAILED', error: error.message });
      }
    }

    this.printSummary();
  }

  printSummary() {
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    
    console.log('='.repeat(50));
    console.log(`Test Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));
    
    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results.filter(r => r.status === 'FAILED').forEach(result => {
        console.log(`  ❌ ${result.name}: ${result.error}`);
      });
    }
  }
}

function startServer(args = [], timeout = 5000) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'src', 'index.js');
    const serverProcess = spawn('node', [serverPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverReady = false;
    let output = '';

    const timer = setTimeout(() => {
      if (!serverReady) {
        serverProcess.kill('SIGKILL');
        reject(new Error(`Server did not start within ${timeout}ms. Output: ${output}`));
      }
    }, timeout);

    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (data.toString().includes('Socket.IO server listening')) {
        serverReady = true;
        clearTimeout(timer);
        resolve(serverProcess);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    serverProcess.on('exit', (code) => {
      if (!serverReady) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function connectClient(port = 3000) {
  return new Promise((resolve, reject) => {
    const client = io(`http://localhost:${port}`);
    
    client.on('connect', () => {
      resolve(client);
    });

    client.on('connect_error', (error) => {
      reject(error);
    });

    setTimeout(() => {
      reject(new Error('Client connection timeout'));
    }, 3000);
  });
}

function connectClientWithListeners(port = 3000, listeners = {}) {
  return new Promise((resolve, reject) => {
    const client = io(`http://localhost:${port}`);
    
    // Set up event listeners BEFORE connecting
    Object.entries(listeners).forEach(([event, handler]) => {
      client.on(event, handler);
    });
    
    client.on('connect', () => {
      resolve(client);
    });

    client.on('connect_error', (error) => {
      reject(error);
    });

    setTimeout(() => {
      reject(new Error('Client connection timeout'));
    }, 3000);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const runner = new TestRunner();

// Test 1: Basic server startup and connection
runner.addTest('Basic server startup and client connection', async () => {
  const serverProcess = await startServer(['--port', '3001', '--', 'echo', 'test']);
  
  try {
    const client = await connectClient(3001);
    
    // Test that we can connect
    if (!client.connected) {
      throw new Error('Client not connected');
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
    await sleep(100);
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Test 2: Test child process stdout events
runner.addTest('Child process stdout events', async () => {
  const serverProcess = await startServer(['--port', '3002', '--line', '--', 'echo', 'Hello World']);
  
  try {
    let receivedOutput = false;
    let outputData = '';
    
    const outputPromise = new Promise((resolve) => {
      // This will be called immediately when events are replayed
      setTimeout(resolve, 100); // Small delay to ensure events are processed
    });

    const client = await connectClientWithListeners(3002, {
      'child-stdout-line': (data) => {
        receivedOutput = true;
        outputData = data.line;
      }
    });

    // Wait for events to be processed 
    await Promise.race([
      outputPromise,
      sleep(3000) // 3 second timeout
    ]);
    
    if (!receivedOutput) {
      throw new Error('Did not receive stdout event');
    }
    
    if (!outputData.includes('Hello World')) {
      throw new Error(`Expected 'Hello World', got: ${outputData}`);
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Test 3: Test child process info event
runner.addTest('Child process info event', async () => {
  const serverProcess = await startServer(['--port', '3003', '--', 'sleep', '1']);
  
  try {
    let receivedInfo = false;
    let processInfo = null;
    
    const infoPromise = new Promise((resolve) => {
      // Small delay to ensure events are processed
      setTimeout(resolve, 100);
    });

    const client = await connectClientWithListeners(3003, {
      'child-info': (data) => {
        receivedInfo = true;
        processInfo = data;
      }
    });

    // Wait for the info event
    await Promise.race([
      infoPromise,
      sleep(2000) // 2 second timeout
    ]);
    
    if (!receivedInfo) {
      throw new Error('Did not receive child-info event');
    }
    
    if (!processInfo.pid) {
      throw new Error('Process info missing pid');
    }
    
    if (!processInfo.command.includes('sleep 1')) {
      throw new Error(`Expected command to include 'sleep 1', got: ${processInfo.command}`);
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Test 4: Test child process exit event
runner.addTest('Child process exit event', async () => {
  const serverProcess = await startServer(['--port', '3004', '--', 'echo', 'test']);
  
  try {
    let receivedExit = false;
    let exitData = null;
    
    const exitPromise = new Promise((resolve) => {
      // Small delay to ensure events are processed
      setTimeout(resolve, 100);
    });

    const client = await connectClientWithListeners(3004, {
      'child-exit': (data) => {
        receivedExit = true;
        exitData = data;
      }
    });

    // Wait for the exit event
    await Promise.race([
      exitPromise,
      sleep(3000) // 3 second timeout
    ]);
    
    if (!receivedExit) {
      throw new Error('Did not receive child-exit event');
    }
    
    if (exitData.code !== 0) {
      throw new Error(`Expected exit code 0, got: ${exitData.code}`);
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Test 5: Test stdin functionality
runner.addTest('Child stdin functionality', async () => {
  const serverProcess = await startServer(['--port', '3005', '--line', '--', 'cat']);
  
  try {
    const client = await connectClient(3005);
    
    let receivedOutput = false;
    let outputData = '';
    
    client.on('child-stdout-line', (data) => {
      receivedOutput = true;
      outputData = data.line;
    });

    // Send input to cat command
    client.emit('child-stdin', 'test input\n');
    
    // Wait for echo back
    await sleep(1000);
    
    if (!receivedOutput) {
      throw new Error('Did not receive stdout after sending stdin');
    }
    
    if (!outputData.includes('test input')) {
      throw new Error(`Expected 'test input', got: ${outputData}`);
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Test 6: Test wait option
runner.addTest('Wait option functionality', async () => {
  const serverProcess = await startServer(['--port', '3006', '--wait', '--line', '--', 'echo', 'waited']);
  
  try {
    // Wait a bit to ensure server is started but process hasn't started yet
    await sleep(500);
    
    const client = await connectClient(3006);
    
    let receivedOutput = false;
    
    client.on('child-stdout-line', (data) => {
      if (data.line.includes('waited')) {
        receivedOutput = true;
      }
    });

    // Wait for the process to start and complete after client connection
    await sleep(2000);
    
    if (!receivedOutput) {
      throw new Error('Process did not start after client connection with --wait option');
    }
    
    client.disconnect();
    serverProcess.kill('SIGTERM');
  } catch (error) {
    serverProcess.kill('SIGKILL');
    throw error;
  }
});

// Run all tests
async function main() {
  try {
    await runner.runTests();
    
    const failed = runner.results.filter(r => r.status === 'FAILED').length;
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test runner error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}