#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const colors = require('colors');
const { EventEmitter } = require('events');

class ProcessManager extends EventEmitter {
  constructor(command, args, options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.options = options;
    this.child = null;
    this.commanderClient = null;
    this.monitorClients = new Set();
    this.lastLogTime = 0;
    this.byteCounts = { stdout: 0, stderr: 0 };
    this.logInterval = parseInt(process.env.LOG_INTERVAL_MS) || 1000;
    this.processInfo = null;
    
    if (!this.options.verbose) {
      setInterval(() => {
        this.logByteCounts();
      }, this.logInterval);
    }
  }

  start() {
    if (this.child) {
      this.log('Process already running, ignoring start request');
      return;
    }

    this.log(`Starting process: ${this.command} ${this.args.join(' ')}`);
    
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processInfo = {
      pid: this.child.pid,
      command: `${this.command} ${this.args.join(' ')}`
    };

    // Emit process info to all clients
    this.emit('child-info', this.processInfo);

    // Handle stdout
    this.child.stdout.on('data', (data) => {
      this.byteCounts.stdout += data.length;
      
      if (this.options.line) {
        const lines = data.toString().split('\n').filter(line => line.length > 0);
        lines.forEach(line => {
          if (this.options.verbose) {
            this.log(`STDOUT: ${line}`.blue);
          }
          const eventData = {
            time: Date.now(),
            line: line
          };
          this.emit('child-stdout-line', eventData);
        });
      } else {
        if (this.options.verbose) {
          this.log(`STDOUT (${data.length} bytes): ${data.toString('hex')}`.blue);
        }
        const eventData = {
          time: Date.now(),
          data: data
        };
        this.emit('child-stdout', eventData);
      }
    });

    // Handle stderr
    this.child.stderr.on('data', (data) => {
      this.byteCounts.stderr += data.length;
      
      if (this.options.line) {
        const lines = data.toString().split('\n').filter(line => line.length > 0);
        lines.forEach(line => {
          if (this.options.verbose) {
            this.log(`STDERR: ${line}`.magenta);
          }
          const eventData = {
            time: Date.now(),
            line: line
          };
          this.emit('child-stderr-line', eventData);
        });
      } else {
        if (this.options.verbose) {
          this.log(`STDERR (${data.length} bytes): ${data.toString('hex')}`.magenta);
        }
        const eventData = {
          time: Date.now(),
          data: data
        };
        this.emit('child-stderr', eventData);
      }
    });

    // Handle process exit
    this.child.on('exit', (code, signal) => {
      this.log(`Process exited with code ${code}, signal: ${signal}`);
      
      const exitInfo = { code, signal };
      this.emit('child-exit', exitInfo);
      
      this.child = null;
      this.processInfo = null;
    });

    // Handle process errors
    this.child.on('error', (err) => {
      this.log(`Process error: ${err.message}`.red);
    });
  }

  writeToStdin(data) {
    if (this.child && this.child.stdin && this.child.stdin.writable) {
      this.child.stdin.write(data);
      return true;
    }
    return false;
  }

  kill() {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve();
        return;
      }

      const child = this.child;
      let resolved = false;

      // Listen for the child process to exit
      const onExit = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      child.once('exit', onExit);
      child.once('close', onExit);

      // Try graceful termination first
      console.log('Sending SIGTERM to child process...');
      child.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!resolved && child && !child.killed) {
          console.log('Child process did not exit gracefully, force killing...');
          child.kill('SIGKILL');
          
          // Give it a moment to force kill, then resolve anyway
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }, 1000);
        }
      }, 5000);
    });
  }

  addCommanderClient(clientId) {
    if (this.commanderClient) {
      return false; // Reject: commander already exists
    }
    this.commanderClient = clientId;
    this.log(`Commander client connected: ${clientId}`);
    this.start(); // Start child process when commander connects
    return true;
  }

  removeCommanderClient(clientId) {
    if (this.commanderClient === clientId) {
      this.log(`Commander client disconnected: ${clientId}`);
      this.commanderClient = null;
      if (this.child) {
        this.log('Killing child process due to commander disconnect');
        this.kill();
      }
    }
  }

  addMonitorClient(clientId) {
    this.monitorClients.add(clientId);
    this.log(`Monitor client connected: ${clientId}. Active monitors: ${this.monitorClients.size}`);
  }

  removeMonitorClient(clientId) {
    this.monitorClients.delete(clientId);
    this.log(`Monitor client disconnected: ${clientId}. Active monitors: ${this.monitorClients.size}`);
  }

  hasCommanderClient() {
    return !!this.commanderClient;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  logByteCounts() {
    const now = Date.now();
    if (now - this.lastLogTime >= this.logInterval) {
      if (this.byteCounts.stdout > 0 || this.byteCounts.stderr > 0) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Bytes received - STDOUT: ${this.byteCounts.stdout}, STDERR: ${this.byteCounts.stderr}`);
        this.byteCounts = { stdout: 0, stderr: 0 };
      }
      this.lastLogTime = now;
    }
  }
}

function createServer(options) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  let processManager = null;

  // Extract command and args
  const commandArgs = options._;
  if (commandArgs.length === 0) {
    console.error('Error: No command specified after --'.red);
    process.exit(1);
  }

  const command = commandArgs[0];
  const args = commandArgs.slice(1);

  const processOptions = {
    verbose: options.verbose,
    line: options.line
  };

  // Create process manager
  processManager = new ProcessManager(command, args, processOptions);

  // Create namespaces
  const commanderNamespace = io.of('/commander');
  const monitorNamespace = io.of('/monitor');

  // Forward events from process manager to both namespaces
  ['child-stdout', 'child-stderr', 'child-stdout-line', 'child-stderr-line', 'child-exit', 'child-info'].forEach(eventName => {
    processManager.on(eventName, (data) => {
      commanderNamespace.emit(eventName, data);
      monitorNamespace.emit(eventName, data);
    });
  });

  // Commander namespace - only one client allowed, full control
  commanderNamespace.on('connection', (socket) => {
    const success = processManager.addCommanderClient(socket.id);
    
    if (!success) {
      console.log(`Commander client connection rejected (already exists): ${socket.id}`);
      socket.emit('connection-rejected', { reason: 'Commander client already connected' });
      socket.disconnect(true);
      return;
    }

    // Send current process info if available
    if (processManager.processInfo) {
      socket.emit('child-info', processManager.processInfo);
    }

    // Handle stdin from commander
    socket.on('child-stdin', (data) => {
      if (options.verbose) {
        console.log(`Received stdin from commander ${socket.id}: ${data}`);
      }
      processManager.writeToStdin(data);
    });

    socket.on('disconnect', () => {
      processManager.removeCommanderClient(socket.id);
    });
  });

  // Monitor namespace - multiple clients allowed, read-only
  monitorNamespace.on('connection', (socket) => {
    processManager.addMonitorClient(socket.id);

    // Send current process info if available
    if (processManager.processInfo) {
      socket.emit('child-info', processManager.processInfo);
    }

    // Ignore stdin from monitor clients
    socket.on('child-stdin', (data) => {
      if (options.verbose) {
        console.log(`Ignoring stdin from monitor client ${socket.id}: ${data}`);
      }
      socket.emit('error', { message: 'Monitor clients cannot send stdin data' });
    });

    socket.on('disconnect', () => {
      processManager.removeMonitorClient(socket.id);
    });
  });

  // Start the server
  server.listen(options.port, () => {
    console.log(`Socket.IO server listening on port ${options.port}`);
    console.log(`Commander namespace: /commander (single client)`);
    console.log(`Monitor namespace: /monitor (multiple clients)`);
    if (options.verbose) {
      console.log(`Options: ${JSON.stringify(processOptions, null, 2)}`);
    }
  });

  // Graceful shutdown - handle both SIGINT and SIGTERM
  const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    
    try {
      // First, kill the child process and wait for it to exit
      await processManager.kill();
      console.log('Child process terminated successfully.');
      
      // Then close the server
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
      
      // Force exit after 2 more seconds if server doesn't close
      setTimeout(() => {
        console.log('Force exiting...');
        process.exit(1);
      }, 2000);
      
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('port', {
    alias: 'p',
    type: 'number',
    default: 3000,
    describe: 'Port number for the Socket.IO server'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Enable verbose logging'
  })
  .option('line', {
    alias: 'l',
    type: 'boolean',
    default: false,
    describe: 'Line mode for child process output (treat as plain text lines instead of binary data)'
  })
  .help()
  .example('$0 --port 4000 --verbose -- echo "Hello World"', 'Run echo command with verbose logging on port 4000')
  .example('$0 --line -- tail -f /var/log/system.log', 'Monitor system log in line mode')
  .demandCommand(1, 'You must specify a command to run after --')
  .argv;

// Start the server
createServer(argv);