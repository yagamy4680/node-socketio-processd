
`node-socketio-processd` is a small command-line tool that will wrap an existing command-line interface program, and allow it to be accessed via Socket.IO. This allows you to run a command-line program on a server, and interact with it from a web browser or any other Socket.IO client.

The tool accepts the following arguments:

- `--port` (or `-p`): The port number on which the Socket.IO server will listen. Default is 3000.
- `--verbose` (or `-v`): Enable verbose logging. Default is false.
- `--wait` (or `-w`): Wait for a client to connect before starting the child process. Default is false.
- `--restart` (or `-r`): Automatically restart the child process if it exits. Default is false.
- `--line` (or `-l`): Line mode for the child process, which will treat the output as plain text of lines instead of binary data. Default is false (treated as Raw mode).
- `--` (double dash): Indicates the end of the options for `node-socketio-processd` and the beginning of the command-line program to run.

The `--` is used to separate the arguments for `node-socketio-processd` from the command-line program you want to run. For example:

```bash
$ node-socketio-processd --port 4000 --verbose -- my-command --arg1 value1 --arg2 value2
```

This will start the Socket.IO server on port 4000 with verbose logging enabled, and run `my-command` with the specified arguments.


The tool captures `STDOUT` and `STDERR` from the child process and emits them as Socket.IO events (`child-stdout` and `child-stderr`, respectively). It also listens for a `child-stdin` event from the client, which allows you to send input to the child process. The tool also handles process exit and emits an `child-exit` event with the exit code when the child process terminates. The tool allows multiple clients to connect and interact with the same child process simultaneously, and it handles client disconnections gracefully without affecting the child process. When a client disconnects, the tool logs the disconnection event but keeps the child process running for other connected clients. When a client is connected, the tool emits a `child-info` event with the process ID and the command being executed, allowing clients to display this information if needed.

When the `--wait` option is used, the tool will wait for a client to connect before starting the child process. This can be useful if you want to ensure that a client is ready to interact with the process before it begins execution.

When the `--restart` option is used, the tool will automatically restart the child process if it exits. This can be useful for long-running processes that may occasionally crash or exit unexpectedly. The tool will log each restart event and emit a `child-restart` event to connected clients, allowing them to be aware of the process restarts.

By default, the tool treats the output from the child process as binary data. However, when the `--line` option is used, it will treat the output as plain text, separated by newlines. When in LINE mode, the tool will also split the output into lines and emit each line as a separate event, making it easier for clients to process and display the output in real-time. This can be particularly useful for command-line programs that produce line-based output, such as logs or status updates. The tool will emit `child-stdout-line` and `child-stderr-line` events for each line of output, allowing clients to handle them accordingly. In RAW mode, the tool will emit `child-stdout` and `child-stderr` events with the raw output data as a Buffer, allowing clients to handle the binary data as needed.

In LINE mode and verbose logging enabled, the tool will log each line of output from the child process with a timestamp to current console, marked in different colors (STDOUT with blue while STDERR with magenta), making it easier to track the output in real-time. In RAW mode, the tool will output the raw data from the child process to the console in hex format, prefixed with a timestamp and marked in different colors (STDOUT with blue while STDERR with magenta) for better visibility. This allows you to see the output in real-time while also providing the option to process it as needed through the Socket.IO events.

When the verbose is disabled, the tool will output the number of received bytes from the child process for each `STDOUT` and `STDERR` event periodically, along with a timestamp, without showing the actual content of the output. This can be useful for monitoring the activity of the child process without overwhelming the console with detailed output. The periodic logging of byte counts will occur every 1 seconds, providing a summary of the data being emitted by the child process while keeping the console output concise. The period can be adjusted as needed by the environment variable `LOG_INTERVAL_MS` (default is 1000 milliseconds).

The events emitted by the tool include:

- `child-stdout`: Emitted when the child process writes to `STDOUT`. The event data contains epoch time and the output data as a Buffer. Applicable only in RAW mode.
- `child-stderr`: Emitted when the child process writes to `STDERR`. The event data contains epoch time and the output data as a Buffer. Applicable only in RAW mode.
- `child-exit`: Emitted when the child process exits. The event data contains the exit code and signal (if any).
- `child-info`: Emitted when a client connects, containing the process ID and the command being executed.
- `child-restart`: Emitted when the child process is automatically restarted due to the `--restart` option, containing the new process ID and the command being executed.
- `child-stdout-line`: Emitted for each line of output from `STDOUT` when in line mode. The event data contains epoch time and the line of output as a string. Applicable only in LINE mode.
- `child-stderr-line`: Emitted for each line of output from `STDERR` when in line mode. The event data contains epoch time and the line of output as a string. Applicable only in LINE mode.

The events emitted by the clients include:

- `child-stdin`: Listened for from the client, used to send input to the child process. The event data should contain the input data as a Buffer or string.
- `request-restart`: Listened for from the client, used to request a manual restart of the child process when the `--restart` option is enabled. The tool will kill the current child process, wait until it exits, and then start a new instance of the child process. The tool will log the manual restart event and emit a `child-restart` event to connected clients, allowing them to be aware of the process restart. In case the child process does not exit within a reasonable time after receiving the kill signal, the tool will forcefully terminate it to ensure that a new instance can be started without delay.



## Dependencies

- `express`: A web framework for Node.js, used to create the HTTP server that Socket.IO will attach to.
- `socket.io`: A library for real-time web applications, used to create the Socket.IO server.
- `yargs`: A library for parsing command-line arguments.
- `colors`: A library for adding colors to console output, used for logging.

Development dependencies include:

- `socket.io-client`: A library for testing the Socket.IO server by creating a client that can connect and interact with it.


## Tests

A simple test suite is included in the `test` directory, which uses `socket.io-client` to connect to the Socket.IO server and verify that it can receive events and send input to the child process correctly. The tests cover basic functionality such as receiving `STDOUT` and `STDERR` events, sending input to the child process, and handling process exit events.