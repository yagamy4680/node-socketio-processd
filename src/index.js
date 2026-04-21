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
    this.clients = new Set();
    this.lastLogTime = 0;
    this.byteCounts = { stdout: 0, stderr: 0 };
    this.logInterval = parseInt(process.env.LOG_INTERVAL_MS) || 1000;
    
    // Simple event history for new clients
    this.processInfo = null;
    this.outputHistory = [];
    this.exitInfo = null;
    this.hasExited = false;
    
    if (!this.options.verbose) {
      setInterval(() => {
        this.logByteCounts();
      }, this.logInterval);
    }
  }

  emitAndBuffer(eventType, eventData) {
    // Store in output history for replay to new clients
    this.outputHistory.push({ type: eventType, data: eventData });
    
    // Emit to current clients
    this.emit(eventType, eventData);
  }

  replayEventsToClient(socket) {
    // Send process info first if available
    if (this.processInfo) {
      socket.emit('child-info', this.processInfo);
    }

    // Replay buffered events
    this.outputHistory.forEach(({ type, data }) => {
      if (type !== 'child-info') { // Don't duplicate child-info
        socket.emit(type, data);
      }
    });

    // Send exit info if process has exited
    if (this.hasExited && this.exitInfo) {
      socket.emit('child-exit', this.exitInfo);
    }
  }

  start(isRestart = false) {
    if (this.child) {
      this.log('Process already running, killing existing process...');
      this.child.kill('SIGTERM');
      
      // Wait for process to exit, then restart
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.log('Force killing process...');
          this.child.kill('SIGKILL');
        }
        this._spawn(true);
      }, 5000);
    } else {
      this._spawn(isRestart);
    }
  }

  _spawn(isRestart = false) {
    this.log(`Starting process: ${this.command} ${this.args.join(' ')}`);
    
    // Reset state for new process
    if (!isRestart) {
      this.outputHistory = [];
      this.hasExited = false;
      this.exitInfo = null;
    }
    
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processInfo = {
      pid: this.child.pid,
      command: `${this.command} ${this.args.join(' ')}`
    };

    // Always emit process info (don't buffer - handled in addClient)
    this.emit('child-info', this.processInfo);
    
    // Only emit restart event if this is actually a restart
    if (isRestart) {
      this.emit('child-restart', this.processInfo); // Don't buffer restart events
    }

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
          this.emitAndBuffer('child-stdout-line', eventData);
        });
      } else {
        if (this.options.verbose) {
          this.log(`STDOUT (${data.length} bytes): ${data.toString('hex')}`.blue);
        }
        const eventData = {
          time: Date.now(),
          data: data
        };
        this.emitAndBuffer('child-stdout', eventData);
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
          this.emitAndBuffer('child-stderr-line', eventData);
        });
      } else {
        if (this.options.verbose) {
          this.log(`STDERR (${data.length} bytes): ${data.toString('hex')}`.magenta);
        }
        const eventData = {
          time: Date.now(),
          data: data
        };
        this.emitAndBuffer('child-stderr', eventData);
      }
    });

    // Handle process exit
    this.child.on('exit', (code, signal) => {
      this.log(`Process exited with code ${code}, signal: ${signal}`);
      
      this.exitInfo = { code, signal };
      this.hasExited = true;
      
      this.emitAndBuffer('child-exit', this.exitInfo);
      
      if (this.options.restart) {
        this.log('Restarting process due to --restart option...');
        setTimeout(() => this.start(true), 1000);
      } else {
        this.child = null;
      }
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
    if (this.child) {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  addClient(clientId, socket) {
    this.clients.add(clientId);
    // Replay events to the new client
    this.replayEventsToClient(socket);
  }

  removeClient(clientId) {
    this.clients.delete(clientId);
    this.log(`Client ${clientId} disconnected. Active clients: ${this.clients.size}`);
  }

  hasClients() {
    return this.clients.size > 0;
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
    line: options.line,
    restart: options.restart
  };

  // Create process manager
  processManager = new ProcessManager(command, args, processOptions);

  // Forward events from process manager to Socket.IO clients
  ['child-stdout', 'child-stderr', 'child-stdout-line', 'child-stderr-line', 'child-exit', 'child-info', 'child-restart'].forEach(eventName => {
    processManager.on(eventName, (data) => {
      io.emit(eventName, data);
    });
  });

  // Socket.IO event handlers
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    processManager.addClient(socket.id, socket);

    // Start process if waiting for clients and this is the first client
    if (options.wait && processManager.clients.size === 1 && !processManager.child) {
      console.log('First client connected, starting process...');
      processManager.start();
    }

    // Handle stdin from client
    socket.on('child-stdin', (data) => {
      if (options.verbose) {
        console.log(`Received stdin from client ${socket.id}: ${data}`);
      }
      processManager.writeToStdin(data);
    });

    // Handle restart requests
    socket.on('request-restart', () => {
      if (options.restart) {
        console.log(`Restart requested by client ${socket.id}`);
        processManager.start(true);
      } else {
        console.log(`Restart requested by client ${socket.id}, but --restart option is not enabled`);
      }
    });

    socket.on('disconnect', () => {
      processManager.removeClient(socket.id);
    });
  });

  // Start the process immediately if not waiting for clients
  if (!options.wait) {
    processManager.start();
  }

  // Start the server
  server.listen(options.port, () => {
    console.log(`Socket.IO server listening on port ${options.port}`);
    if (options.verbose) {
      console.log(`Options: ${JSON.stringify(processOptions, null, 2)}`);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    processManager.kill();
    server.close(() => {
      process.exit(0);
    });
  });
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
  .option('wait', {
    alias: 'w',
    type: 'boolean',
    default: false,
    describe: 'Wait for a client to connect before starting the child process'
  })
  .option('restart', {
    alias: 'r',
    type: 'boolean',
    default: false,
    describe: 'Automatically restart the child process if it exits'
  })
  .option('line', {
    alias: 'l',
    type: 'boolean',
    default: false,
    describe: 'Line mode for child process output (treat as plain text lines instead of binary data)'
  })
  .help()
  .example('$0 --port 4000 --verbose -- echo "Hello World"', 'Run echo command with verbose logging on port 4000')
  .example('$0 --wait --restart -- node server.js', 'Wait for client and auto-restart node server')
  .demandCommand(1, 'You must specify a command to run after --')
  .argv;

// Start the server
createServer(argv);