# Contributing to AL Productivity Pack

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### Reporting Bugs

- Use the [bug report template](https://github.com/rshuklaOnalletec/al-productivity-pack/issues/new?template=bug_report.md)
- Include your VS Code version, AL Language extension version, and OS
- Provide steps to reproduce the issue
- Include sample `.al` files if relevant (remove any proprietary code)

### Suggesting Features

- Use the [feature request template](https://github.com/rshuklaOnalletec/al-productivity-pack/issues/new?template=feature_request.md)
- Describe the use case and why it would be valuable
- Check existing issues first to avoid duplicates

### Pull Requests

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm run pretest`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

```bash
# Clone the repo
git clone https://github.com/rshuklaOnalletec/al-productivity-pack.git
cd al-productivity-pack

# Install dependencies
npm install

# Compile
npm run compile

# Run in development (F5 in VS Code)
# This opens a new Extension Development Host window
```

## Project Structure

```
src/
├── extension.ts                    # Extension entry point
├── types.ts                        # Shared type definitions
├── utils/
│   └── alParser.ts                 # AL file parsing logic
└── features/
    └── eventSubscriberFinder/
        ├── eventIndexer.ts         # Workspace indexing engine
        ├── subscriberMapper.ts     # Event-subscriber mapping
        ├── boilerplateGenerator.ts # Code generation
        ├── treeView.ts             # Explorer tree view
        └── index.ts                # Feature barrel export
```

## Code Style

- TypeScript strict mode
- ESLint with `@typescript-eslint` rules
- camelCase for variables/functions, PascalCase for types/classes
- No `any` types unless absolutely necessary

## Testing

```bash
npm run pretest  # Compile + lint
npm run test     # Run test suite
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code refactoring
- `test:` adding/updating tests
- `chore:` maintenance tasks

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
