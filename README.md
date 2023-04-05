[![Moleculer](https://badgen.net/badge/Powered%20by/Moleculer/0e83cd)](https://moleculer.services)

# bootstrap
This is a [Moleculer](https://moleculer.services/)-based microservices project. Generated with the [Moleculer CLI](https://moleculer.services/docs/0.14/moleculer-cli.html).

## Usage

### ipxe compile

install deps
```
sudo apt install -y make gcc binutils perl mtools mkisofs syslinux liblzma-dev isolinux
```
download and enable ping and nfs
```
git clone git://git.ipxe.org/ipxe.git
cd ipxe/src

sed -i 's/#undef\tDOWNLOAD_PROTO_NFS/#define\tDOWNLOAD_PROTO_NFS/' config/general.h
sed -i 's/\/\/#define\ PING_CMD/#define\ PING_CMD/' config/general.h
sed -i 's/\/\/#define\ IPSTAT_CMD/#define\ IPSTAT_CMD/' config/general.h
sed -i 's/\/\/#define\ REBOOT_CMD/#define\ REBOOT_CMD/' config/general.h
sed -i 's/\/\/#define\ POWEROFF/#define\ POWEROFF/' config/general.h

nano embed.ipxe
```
chainboot next server
```nano embed.ipxe```

```
#!ipxe
dhcp && goto netboot || goto dhcperror

:dhcperror
prompt --key s --timeout 10000 DHCP failed, hit 's' for the iPXE shell; reboot in 10 seconds && shell || reboot

:netboot
chain tftp://${next-server}/main.ipxe ||
prompt --key s --timeout 10000 Chainloading failed, hit 's' for the iPXE shell; reboot in 10 seconds && shell || reboot
```

Now compile for 64x and 32 bit
```
make bin-x86_64-efi/ipxe.efi EMBED=embed.ipxe
make bin/undionly.kpxe EMBED=embed.ipxe
```

Now copy over
```
cp bin-x86_64-efi/ipxe.efi ../../public/ipxe.efi
cp bin/undionly.kpxe ../../public/undionly.kpxe
```
Now clean up
```
cd ../../
rm -rf ipxe
```


### k3os files

k3os netboot files
```
VERSION=v0.21.5-k3s2r1
SOURCE_HTTP=https://github.com/rancher/k3os/releases/download

mkdir public/k3os
cd public/k3os
wget $SOURCE_HTTP/$VERSION/k3os-amd64.iso
wget $SOURCE_HTTP/$VERSION/k3os-initrd-amd64
wget $SOURCE_HTTP/$VERSION/k3os-vmlinuz-amd64

```



## Services
- **api**: API Gateway services
- **greeter**: Sample service with `hello` and `welcome` actions.


## Useful links

* Moleculer website: https://moleculer.services/
* Moleculer Documentation: https://moleculer.services/docs/0.14/

## NPM scripts

- `npm run dev`: Start development mode (load all services locally with hot-reload & REPL)
- `npm run start`: Start production mode (set `SERVICES` env variable to load certain services)
- `npm run cli`: Start a CLI and connect to production. Don't forget to set production namespace with `--ns` argument in script
- `npm run lint`: Run ESLint
- `npm run ci`: Run continuous test mode with watching
- `npm test`: Run tests & generate coverage report
- `npm run dc:up`: Start the stack with Docker Compose
- `npm run dc:down`: Stop the stack with Docker Compose
