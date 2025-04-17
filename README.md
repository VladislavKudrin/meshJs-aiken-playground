# What is this repository

This repository has [scripts](https://github.com/VladislavKudrin/meshJs-aiken-playground/tree/main/scripts) for interracting with validators in MeshJs. In uses plutus.json file generated in [Aiken Playgound](https://github.com/VladislavKudrin/aiken-playground).

I will probably combine these repositories later...

```bash
bun install
```

Mint:

```bash
bun run scripts/mint.ts --t {your token name}
```

Burn:

```bash
bun run scripts/burn.ts --t {your token name}
```

Mint CIP68:

```bash
bun run scripts/mint68.ts --t {your token name}
```

Change CIP68:

```bash
bun run scripts/edit68.ts --t {your token name}
```

Burn CIP68:

```bash
bun run scripts/burn68.ts --t {your token name}
```
