# Advanced PXE Boot Server Services

This documentation describes the services that together provide the functionality for an advanced PXE (Preboot Execution Environment) boot server. These services enable efficient management of DHCP leases, kernel configurations, HTTP requests, and TFTP operations.

---

## **DHCP Service**

### **Overview**
The `dhcp` service handles DHCP server functionalities, including IP lease allocation and responding to DHCP requests for PXE booting.

### **Settings**
- **Fields**: Defines the schema for DHCP entries (IP, MAC address, lease times, server configurations, etc.).
- **Scopes**: Includes a `notDeleted` scope for soft-deleted entries.
- **DHCP Configuration**:
  - `port`: The DHCP server port (default: 67).
  - `serverAddress`: The server's IP address.
  - `gateways`, `dns`: Lists of gateways and DNS servers.
  - `range`: IP address allocation range.
  - `nextServer`, `tftpServer`: Addresses for next-hop servers.
  - `bootFile`: PXE boot file path.
  - `leaseTime`: Lease duration in seconds.

### **Key Actions**
- *None currently defined in the code snippet.*

### **Methods**
- **createServer()**: Initializes and starts the DHCP server.
- **attachEvents(server)**: Attaches event handlers for DHCP server events (e.g., discover, request).
- **createNewLease(ctx, mac)**: Allocates a new IP lease for a given MAC address.
- **handleDiscover(ctx, event)**: Handles DHCP discovery requests.
- **handleRequest(ctx, event)**: Handles DHCP request acknowledgments.

### **Lifecycle Hooks**
- **created()**: Initializes locks and server variables.
- **started()**: Starts the DHCP server.
- **stopped()**: Stops the DHCP server.

---

## **Kernels Service**

### **Overview**
The `kernels` service manages bootable kernels for PXE. It provides functionality to define, store, and retrieve kernel configurations.

### **Settings**
- **Fields**: Defines the schema for kernel configurations, including:
  - Name, version, architecture.
  - Paths for `vmlinuz`, `initramfs`, and optional files like `modloop`, `iso`, etc.
  - `cmdline`: Kernel command-line arguments.
  - `k3os`: Additional configuration for K3OS kernels.
- **Kernel Types**: Predefined kernel templates (e.g., Alpine, K3OS).

### **Key Actions**
- **lookup**:
  - **REST**: `GET /lookup/:name`
  - **Params**: `name` (required)
  - **Description**: Finds a kernel configuration by name.
- **generateBootFile**:
  - **REST**: `GET /generateBootFile/:node/:kernel`
  - **Params**: `node` and `kernel` (both required)
  - **Description**: Generates an iPXE boot file for a given node and kernel.

### **Methods**
- **generateBootFile(ctx, node, kernel)**: Creates an iPXE boot file for specified kernel and node.
- **loadKernels()**: Loads predefined kernels into the database.
- **getKernelById(ctx, id)**: Retrieves a kernel configuration by its ID.

### **Lifecycle Hooks**
- **created()**: Sets up the service.
- **started()**: Loads kernel configurations on service start.
- **stopped()**: Cleans up resources on service stop.

---

## **HTTP Server Service**

### **Overview**
The `http` service provides HTTP server capabilities, allowing interaction with PXE-related files and configurations.

### **Key Features**
- Serves static files from a specified public directory.
- Handles PXE-related requests, such as serving kernel files, K3OS configurations, and SSH keys.
- Supports dynamic file caching and efficient file downloads.
- Allows for APK overlay uploads for specific kernels.

### **Settings**
- **HTTP Configuration**:
  - `http.port` (default: `80`): Port for the HTTP server.
  - `http.address` (default: `0.0.0.0`): IP address for the server.
  - `http.root` (default: `./public`): Root directory for serving static files.
- **SSL Configuration**:
  - `ssl.key` (default: `null`): Path to the SSL key file.
  - `ssl.cert` (default: `null`): Path to the SSL certificate file.

### **Key Methods**
- **createHTTPServer()**: Creates and starts the HTTP server, attaching request handlers and logging server events.
- **closeServer()**: Closes the HTTP server gracefully.
- **onHTTPRequest(req, res)**: Routes HTTP requests based on the URL.
- **handleK3OSConfig(ctx, req, res)**: Generates a K3OS YAML configuration file for the requesting node.
- **handleSSHKeys(ctx, req, res)**: Serves authorized SSH keys for a node identified by its IP address.
- **handleApkOvlUpload(ctx, req, res)**: Handles APK overlay file uploads.
- **handleMirror(ctx, req, res)**: Serves or caches files for kernel configurations.

### **Lifecycle Hooks**
- **created()**: Initializes the HTTP server and file cache.
- **started()**: Starts the HTTP server by calling `createHTTPServer`.
- **stopped()**: Stops the HTTP server by calling `closeServer`.

---

## **TFTP Server Service**

### **Overview**
The `tftp` service provides TFTP server capabilities to support PXE boot processes. It serves critical files such as iPXE binaries and boot configuration files.

### **Settings**
- **TFTP Configuration**:
  - `tftp.port` (default: `69`): Port for the TFTP server.
  - `tftp.address` (default: `0.0.0.0`): Host address for the server.
  - `tftp.root` (default: `./public`): Root directory for TFTP files.
  - `tftp.ipxe` (default: `ipxe.efi`): Default iPXE binary file.
  - `tftp.main` (default: `main.ipxe`): Main boot configuration file.

### **Key Methods**
- **createTFTPServer()**: Creates the TFTP server instance and attaches request handlers for incoming requests.
- **startTFTPServer()**: Starts the TFTP server, listening on the configured port and address.
- **stopTFTPServer()**: Stops the TFTP server gracefully.
- **onTFTPRequest(req, res)**: Handles incoming TFTP requests.
- **handleIpxeRequest(ctx, req, res, ip)**: Processes requests for the iPXE binary.
- **handleMainRequest(ctx, req, res, ip)**: Processes requests for the main boot configuration.
- **serveFile(req, res, file, contents)**: Serves a file or dynamically provided content.

### **Lifecycle Hooks**
- **created()**: Initializes the TFTP server instance.
- **started()**: Starts the TFTP server when the service is launched.
- **stopped()**: Stops the TFTP server when the service is stopped.

---

## **Integration**
- The `dhcp` service interacts with the `kernels` service for providing necessary files during PXE boot.
- The `http` and `tftp` services serve files required for kernel and PXE operations.
- Nodes are dynamically registered and resolved during DHCP requests.
- iPXE boot files are generated dynamically with kernel configurations.

---

## **Dependencies**
- `tftp`: Module for creating and managing the TFTP server.
- `fs`: File system module for handling file streams.
- `path`: Provides utilities for working with file paths.

---

## **Logging and Error Handling**
- Logs key events such as file transfers and errors.
- Provides detailed warnings for invalid or failed requests.

