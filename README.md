# Advanced PXE Boot Server Services

A robust Preboot Execution Environment (PXE) boot server implementation with DHCP, TFTP, and HTTP services for network booting and provisioning.

## Features

- DHCP server with PXE boot support
- TFTP server for boot file delivery
- HTTP server for kernel and configuration files
- Support for multiple kernel types (Alpine Linux, K3OS)
- Dynamic node registration and configuration
- Browser-based management UI

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