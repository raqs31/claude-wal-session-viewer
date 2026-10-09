# Contributing

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>[(scope)][!]: <description>

[body]

[footer(s)]
```

### Types

| Type       | Use for                                                    |
|------------|------------------------------------------------------------|
| `feat`     | A new feature                                              |
| `fix`      | A bug fix                                                  |
| `docs`     | Documentation only                                         |
| `style`    | Formatting, with no change in behaviour                    |
| `refactor` | A code change that neither fixes a bug nor adds a feature  |
| `perf`     | A performance improvement                                  |
| `test`     | Adding or correcting tests                                 |
| `build`    | The build system or dependencies                           |
| `ci`       | CI configuration and workflows                             |
| `chore`    | Maintenance that touches neither source nor tests          |
| `revert`   | Reverting an earlier commit                                |

### Scopes

The scope is optional. One is defined:

| Scope | Use for                                                                                                    |
|-------|------------------------------------------------------------------------------------------------------------|
| `ai`  | Changes aimed at AI agents working in this repo: `AGENTS.md`, `CLAUDE.md`, `.ai/`, `.claude/`, agent rules, prompts and skills |

`ai` combines with any type: `docs(ai): add AGENTS.md`, `chore(ai): allow npm scripts in agent settings`.

The `wal-hook` plugin under `plugins/` is product code, not `ai`: it is what this repo ships, not
guidance for agents working on it.

### Description

- Imperative mood, lower case, no trailing period: `fix: resolve stale session badge`.
- Say what the commit does, not what was wrong before it.

### Breaking changes

Mark a breaking change with `!` before the colon, a `BREAKING CHANGE:` footer, or both:

```
feat!: drop the --legacy-port flag

BREAKING CHANGE: use --port instead.
```

### Examples

```
feat: show token cost per session in the sidebar
fix(ai): correct the test command in AGENTS.md
ci: publish to GitHub Packages on tags
revert: feat: show token cost per session in the sidebar
```
