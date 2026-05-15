# 005 Publication Hygiene

This document defines public repository hygiene before the first GitHub publication and for future public-facing changes.

## Public tracked file rules

- Public tracked files must remain free of external project identifiers unless future license or provenance obligations require explicit attribution for copied code or assets.
- Keep private reference notes only in ignored local files or directories, such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- Do not include external product names, vendor names, repository URLs, binary names, package names, marketplace IDs, support URLs, or storage paths in public docs, examples, scripts, comments, generated files, or ignore rules.
- Use neutral wording such as `external reference project`, `reference implementation`, or `external architecture reference` when a public document needs to discuss the general concept.
- Keep Yet AI product-sensitive values centralized in `product/identity.json` where practical.

## License and provenance exception

If external code, assets, documentation, icons, configuration, or other copyrightable material are copied later, license and provenance notices must be added intentionally. In that case:

- preserve required copyright notices and license text;
- record copied-file provenance in a durable public document;
- add NOTICE or attribution material if required by the copied material's license;
- explain why the public attribution is present;
- verify that the copied material does not also introduce unrelated product identifiers, storage paths, marketplace IDs, or update channels.

## First publication checklist

Before the first GitHub push:

1. Rewrite local history to a clean initial commit that contains only intended public files.
2. Verify tracked file content contains no forbidden external project identifiers.
3. Verify tracked filenames contain no forbidden external project identifiers.
4. Confirm ignored local context files are not staged.
5. Confirm `product/identity.json` contains only Yet AI placeholders or final Yet AI values.
6. Confirm README, docs, and agent instructions describe Yet AI as an independent product.
7. Confirm publication URLs, issue links, and support links are either final Yet AI endpoints or clearly temporary neutral placeholders.

## Verification commands

Run these checks from the repository root before publishing:

```sh
git grep -nEi 'forbidden-external-identifier-pattern' -- .
git ls-files | grep -Ei 'forbidden-external-filename-pattern'
```

Both commands should return no matches for the currently forbidden identifiers defined by the publication task or release checklist.
