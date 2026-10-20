# Third-party notices

pst has no application runtime package dependencies. Its table, timeline, calendar and image export use browser APIs.

The Vite production build can include generated module-preload and bundler helpers. The corresponding notices are preserved in [LICENSE-THIRD-PARTY.txt](./LICENSE-THIRD-PARTY.txt):

| Build tool | Locked version | Notice source |
| --- | --- | --- |
| Vite | 8.3.4 | Installed `vite/LICENSE.md`, core MIT section |
| Rolldown | 1.2.14 | Installed `rolldown/LICENSE` and `rolldown/THIRD-PARTY-LICENSE` |

Both notice files are included in `dist/`. Build tools themselves are development dependencies; this list covers generated browser helpers, not distribution of `node_modules`.

The earlier VisActor, VRender and Gantt export dependencies have been removed from source imports and the lockfile. Their old notices are available in Git history and are not an inventory of the current build.

This file does not assign a license to pst's own source code. Recheck notices when adding dependencies or changing build tools.
