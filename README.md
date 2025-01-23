# Advanced PXE Boot Server Services

A robust Preboot Execution Environment (PXE) boot server implementation with DHCP, TFTP, and HTTP services for network booting and provisioning.

## Features

- DHCP server with PXE boot support
- TFTP server for boot file delivery
- HTTP server for kernel and configuration files
- Support for multiple kernel types (Alpine Linux, K3OS)
- Dynamic node registration and configuration
- Browser-based management UI

## Installation

To run the services, install Docker and run the following command:
```bash
docker run -d --name palm-tree --restart always -p 80:80 -p 67:67 -p 69:69 -v /path/to/data:/app/db ghcr.io/flybyme/palm-tree:master
```
For Nats as the transporter

```bash
docker run -d --name palm-tree --restart always -p 80:80 -p 67:67 -p 69:69 -e TRANSPORTER=nats://10.1.10.1:4222 -v /path/to/data:/app/db ghcr.io/flybyme/palm-tree:master
```

Replace `/path/to/data` with the path to your data directory.

## Services

### DHCP Service

The `dhcp` service manages IP address leasing and PXE boot configurations:

- Dynamic IP address allocation
- PXE boot file configuration
- Boot server settings
- Node registration on first boot
- Lease tracking and management

#### Configuration

```javascript
{
  port: 67,
  serverAddress: "10.1.10.1",
  gateways: ["10.1.10.1"],
  dns: ["1.1.1.1"],
  range: [10, 99],
  nextServer: "10.1.10.1", 
  tftpServer: "10.1.10.1",
  bootFile: "/ipxe.efi",
  leaseTime: 3600
}
```

#### Actions

- `lookup`: Retrieve a lease by IP address.
  - **Method**: GET
  - **Path**: `/lookup/:ip`
  - **Params**: 
    - `ip` (string, required): The IP address to look up.

- `clearDB`: Clear all DHCP leases from the database.
  - **Method**: POST
  - **Path**: `/clear`
  - **Params**: None

#### Methods

- `createServer()`: Creates and configures the DHCP server.
- `attachEvents(server)`: Attaches event handlers to the DHCP server.
- `stopServer()`: Stops the DHCP server.
- `getByMac(ctx, mac)`: Retrieves a lease by MAC address.
- `getByIp(ctx, ip)`: Retrieves a lease by IP address.
- `createNewLease(ctx, mac)`: Creates a new DHCP lease.
- `handleDiscover(ctx, event)`: Handles DHCP discover requests.
- `handleRequest(ctx, event)`: Handles DHCP request acknowledgments.

#### Events

- `nodes.removed`: Handles the removal of nodes and cleans up associated leases.

#### Lifecycle Hooks

- `created()`: Initializes the DHCP server and lock mechanism.
- `started()`: Starts the DHCP server.
- `stopped()`: Stops the DHCP server.

### Kernels Service

The `kernels` service manages bootable kernels for PXE. It provides functionality to define, store, and retrieve kernel configurations.

#### Configuration

```javascript
{
  name: "alpine",
  version: "3.14.0",
  arch: "x86_64", 
  cmdline: "console=tty0 modules=loop,squashfs",
  vmlinuz: "boot/vmlinuz-lts",
  initramfs: "boot/initramfs-lts",
  modloop: "boot/modloop-lts"
}
```

#### Actions

- `lookup`: Retrieve kernel details by name.
  - **Method**: GET
  - **Path**: `/lookup/:name`
  - **Params**: 
    - `name` (string, required): The name of the kernel to look up.

- `generateBootFile`: Generate a boot file for a specific node and kernel.
  - **Method**: GET
  - **Path**: `/generateBootFile/:node/:kernel`
  - **Params**: 
    - `node` (string, required): The ID of the node.
    - `kernel` (string, required): The ID of the kernel.

#### Methods

- `generateBootFile(ctx, node, kernel)`: Generates the boot file content based on the node and kernel configuration.
- `loadKernels()`: Loads the kernel configurations from the database or initializes them if not present.
- `getKernelById(ctx, id)`: Retrieves a kernel configuration by its ID.

#### Kernel Types

The service supports multiple kernel types, including:

- **Alpine Linux**: 
  - `name`: "alpine"
  - `version`: "3.14.0"
  - `arch`: "x86_64"
  - `cmdline`: "console=tty0 modules=loop,squashfs quiet nomodeset"
  - `vmlinuz`: "alpine/netboot/3.14.0/vmlinuz-lts"
  - `initramfs`: "alpine/netboot/3.14.0/initramfs-lts"
  - `modloop`: "alpine/netboot/3.14.0/modloop-lts"
  - `repo`: "alpine/v3.14/main/"
  - `archive`: "http://dl-cdn.alpinelinux.org"
  - `apkovl`: "alpine/netboot/3.14.0/apkovl-lts.apkovl.tar.gz"

- **K3OS**: 
  - `name`: "k3os"
  - `version`: "v0.21.5-k3s2r1"
  - `arch`: "x86_64"
  - `cmdline`: "printk.devkmsg=on console=ttyS0 console=tty1 initrd=initrd.magic"
  - `vmlinuz`: "k3os/v0.21.5-k3s2r1/k3os-vmlinuz-amd64"
  - `initramfs`: "k3os/v0.21.5-k3s2r1/k3os-initramfs-amd64"
  - `options`: 
    - `silent`: true
    - `poweroff`: false
    - `mode`: "install"
    - `config_url`: "k3os/config"
    - `iso_url`: "k3os/v0.21.5-k3s2r1/k3os-amd64.iso"

### HTTP Server Service

The `http` service provides HTTP server capabilities, allowing interaction with PXE-related files and configurations.

#### Configuration

```javascript
{
  http: {
    port: 80,
    address: '0.0.0.0',
    root: './public',
  },
  ssl: {
    key: null,
    cert: null
  }
}
```

#### Actions

- `downloadFile`: Downloads a file from a URL to a specified path.
  - **Method**: POST
  - **Path**: `/downloader`
  - **Params**: 
    - `url` (string, required): The URL of the file to download.
    - `path` (string, required): The local path to save the file.
    - `kernel` (string, required): The name of the kernel associated with the file.

- `cache`: Retrieves the current cache status.
  - **Method**: GET
  - **Path**: `/cache`
  - **Params**: None

- `clearCache`: Clears the cache.
  - **Method**: DELETE
  - **Path**: `/cache`
  - **Params**: None

#### Methods

- `createHTTPServer()`: Creates and configures the HTTP server.
- `closeServer()`: Closes the HTTP server.
- `onHTTPRequest(req, res)`: Handles incoming HTTP requests.
- `handleIgnitionConfig(ctx, req, res)`: Handles requests for CoreOS Ignition configuration.
- `handleApkOvlUpload(ctx, req, res)`: Handles APK overlay uploads.
- `handleSSHKeys(ctx, req, res)`: Handles requests for SSH keys.
- `sendFileResponse(ctx, req, res, filePath, fileSize)`: Sends a file response.
- `sendError(req, res, code, message)`: Sends an error response.
- `serveStatic(ctx, cache)`: Serves static files from the public folder.
- `handleMirror(ctx, req, res)`: Handles HTTP requests for mirrored files.
- `downloadCacheEntry(ctx, cache)`: Downloads a cache entry if it is not already downloading.
- `downloadFile(ctx, url, filePath, cache)`: Downloads a file from a URL to a specified path.
- `createCacheEntry(ctx, url, kernel)`: Creates a cache entry for a file.
- `handleK3OSConfig(ctx, req, res)`: Handles requests for K3OS configuration.

#### Lifecycle Hooks

- `created()`: Initializes the HTTP server and cache.
- `started()`: Starts the HTTP server.
- `stopped()`: Stops the HTTP server.

### Nodes Service

The `nodes` service manages the lifecycle of nodes, including registration, configuration, and status updates. It interacts with the `dhcp`, `kernels`, and `http` services to provide a seamless PXE boot experience.

#### Configuration

```javascript
{
  hostname: "string",
  ip: "string",
  lease: "string",
  kernel: "string",
  password: "string",
  authorizedKeys: "string",
  stage: "string",
  status: "string",
  cores: "number",
  cpuModel: "string",
  memory: "number",
  disks: "array",
  networkInterfaces: "array",
  options: "object",
  controlNode: "boolean",
  token: "string",
  group: "string"
}
```

#### Actions

- `lookup`: Retrieve a node by IP address.
  - **Method**: GET
  - **Path**: `/lookup/:ip`
  - **Params**: 
    - `ip` (string, required): The IP address to look up.

- `register`: Register a new node.
  - **Method**: POST
  - **Path**: `/register`
  - **Params**: 
    - `ip` (string, required): The IP address of the node.
    - `kernel` (string, optional): The kernel to use for the node.

- `setControlNode`: Set a node as a control node.
  - **Method**: POST
  - **Path**: `/:id/set-control-node`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `controlNode` (boolean, required): Whether the node is a control node.

- `controlNode`: Retrieve the control node for a group.
  - **Method**: GET
  - **Path**: `/control-node`
  - **Params**: 
    - `group` (string, optional): The group to look up.

- `setStage`: Set the stage of a node.
  - **Method**: POST
  - **Path**: `/:id/set-stage`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `stage` (string, required): The stage to set.

- `setStatus`: Set the status of a node.
  - **Method**: POST
  - **Path**: `/:id/set-status`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `status` (string, required): The status to set.

- `setLease`: Set the lease of a node.
  - **Method**: POST
  - **Path**: `/:id/set-lease`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `lease` (string, required): The lease to set.

- `setToken`: Set the token of a node.
  - **Method**: POST
  - **Path**: `/:id/set-token`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `token` (string, required): The token to set.

- `getAuthorizedKeys`: Retrieve the authorized keys for a node.
  - **Method**: GET
  - **Path**: `/authorized-keys`
  - **Params**: 
    - `id` (string, required): The ID of the node.

- `setAuthorizedKeys`: Set the authorized keys for a node.
  - **Method**: POST
  - **Path**: `/authorized-keys`
  - **Params**: 
    - `id` (string, required): The ID of the node.
    - `authorizedKeys` (string, required): The authorized keys to set.

- `getSystemInfo`: Retrieve the system information for a node.
  - **Method**: GET
  - **Path**: `/:id/system-info`
  - **Params**: 
    - `id` (string, required): The ID of the node.

- `commission`: Commission a node.
  - **Method**: POST
  - **Path**: `/:id/commission`
  - **Params**: 
    - `id` (string, required): The ID of the node.

- `clearDB`: Clear all nodes from the database.
  - **Method**: POST
  - **Path**: `/clear`
  - **Params**: None

#### Methods

- `getNodeById(ctx, id)`: Retrieves a node by its ID.
- `getNodeByIp(ctx, ip)`: Retrieves a node by its IP address.
- `parseCpuinfoToJson(cpuInfo)`: Parses CPU information to JSON.
- `parseLsblkToJson(json)`: Parses disk information to JSON.
- `parseIpLinkToJson(input)`: Parses network interface information to JSON.
- `parseMeminfoToJson(input)`: Parses memory information to JSON.
- `getAuthorizedKeys(ctx)`: Retrieves the authorized keys from the file system.

#### Lifecycle Hooks

- `created()`: Initializes the nodes service.
- `started()`: Starts the nodes service.
- `stopped()`: Stops the nodes service.

### TFTP Server Service

The `tftp` service provides TFTP server capabilities to support PXE boot processes. It serves critical files such as iPXE binaries and boot configuration files.

#### Configuration

```javascript
{
  tftp: {
    port: 69,
    address: '0.0.0.0',
    root: './public',
    ipxe: 'ipxe.efi',
    main: 'main.ipxe'
  }
}
```

## Integration

- The `dhcp` service interacts with the `kernels` service for providing necessary files during PXE boot.
- The `http` and `tftp` services serve files required for kernel and PXE operations.
- The `nodes` service manages node registration, configuration, and status updates.
- Nodes are dynamically registered and resolved during DHCP requests.
- iPXE boot files are generated dynamically with kernel configurations.

## Dependencies

- `tftp`: Module for creating and managing the TFTP server.
- `fs`: File system module for handling file streams.
- `path`: Provides utilities for working with file paths.

## Logging and Error Handling

- Logs key events such as file transfers and errors.
- Provides detailed warnings for invalid or failed requests.

## Getting Started

To get started with the PXE Boot Server, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/FLYBYME/palm-tree.git
   cd palm-tree
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure the services by editing the configuration files as needed.

4. Start the server:
   ```bash
   npm run dev
   ```

5. Access the management UI in your browser at `http://<server-ip>:<port>`.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) for more information.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.