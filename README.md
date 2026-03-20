# Passus

A conversational AI agent that helps you break down goals and stay accountable.

Passus uses a "fractal" planning philosophy — breaking ambitions down from visions to milestones to weekly strategies to daily tasks — and actively engages you through check-ins, reflections, and adaptive planning.

## Project Structure

Turborepo monorepo with two packages:

- **core/** — Business logic: goal decomposition, scheduling, data access
- **cli/** — Interactive command-line interface

## Development

```bash
nvm use
npm install
npm run build
npm run test
npm run lint
```

## License

MIT
