# Third-party notices

This file records the third-party software used by the browser editor in **pst 0.1.0**. It does not set a license for pst's own application code.

Full copyright notices and license texts are preserved in [LICENSE-THIRD-PARTY.txt](./LICENSE-THIRD-PARTY.txt). Include both files when distributing the browser build.

## Checked scope

Checked on 2026-10-20 against the installed package versions in `package-lock.json`:

- Package license declarations and available license files.
- Upstream license texts where npm packages omit the license file.
- Attributed license comments in the retained VUtils modules.
- The production Vite browser build of this application, using its retained-module graph and emitted runtime chunks.

The production build retained code from the 18 npm dependency packages listed below, plus generated runtime helpers from Vite and Rolldown. This is an inventory and notice-preservation check for this browser output; it is not an audit of every installed development dependency or a complete historical provenance audit of third-party code. Changes to dependencies or import paths require this inventory to be checked again.

## Browser dependencies

| Package | Locked version | Package license declaration |
| --- | --- | --- |
| `@visactor/vtable` | 1.26.8 | MIT |
| `@visactor/vtable-gantt` | 1.26.8 | MIT |
| `@visactor/vtable-editors` | 1.26.8 | MIT |
| `@visactor/vtable-plugins` — Gantt image export entry only | 1.26.8 | MIT; see scope below |
| `@visactor/vrender` | 1.1.12 | MIT |
| `@visactor/vrender-animate` | 1.1.12 | MIT |
| `@visactor/vrender-components` | 1.1.12 | MIT |
| `@visactor/vrender-core` | 1.1.12 | MIT |
| `@visactor/vrender-kits` | 1.1.12 | MIT |
| `@visactor/vdataset` | 1.0.28 | MIT |
| `@visactor/vscale` | 1.0.28 | MIT |
| `@visactor/vutils` | 1.0.28 | MIT; attributed code also uses BSD-3-Clause and ISC |
| `@visactor/vutils-extension` | 2.0.22 | MIT |
| `cssfontparser` | 1.2.1 | MIT |
| `eventemitter3` | 4.0.7 | MIT |
| `gifuct-js` | 2.1.2 | MIT |
| `js-binary-schema-parser` | 2.0.3 | MIT |
| `lodash` | 4.17.21 | MIT |

The installed package license declarations are distinct from licenses of attributed source incorporated inside those packages.

### Generated runtime helpers

The emitted browser code also includes Vite's module-preload support and a Rolldown runtime chunk. These helpers are covered by the following additional notices in the companion text file:

| Source | Installed build-tool version | Notice |
| --- | --- | --- |
| Vite core runtime helpers | 8.3.4 | MIT — VoidZero Inc. and Vite contributors |
| Rolldown runtime helpers | 1.2.14 | MIT — VoidZero Inc. & Contributors; supplied third-party MIT notices for Rollup contributors and Evan Wallace are also preserved |

These entries cover generated browser helpers. They do not imply that the entire Vite or Rolldown build tool is shipped in the browser application.

## Attributed source inside VUtils

The installed `@visactor/vutils` source includes these upstream attributions. Their original comments and applicable license texts are preserved in the companion text file.

| Attributed project or author | Applicable notice | Observed VUtils files |
| --- | --- | --- |
| Vega / University of Washington Interactive Data Lab | BSD-3-Clause | `logger.js`, `common/random.js`, `data-structure/bounds.js` |
| fmin / Ben Frederickson | BSD-3-Clause | `common/bisect.js`, `fmin/blas1.js`, `fmin/nelder-mead.js`, `fmin/conjugate-gradient.js` |
| Jason Davies | BSD-3-Clause | `color/Color.js` |
| Turf / Morgan Herlocker | MIT | `geo/invariant.js` |
| venn.js / Ben Frederickson | MIT | `geo/constant.js`, `geo/circle-intersection.js` |
| d3-time-format / Mike Bostock | ISC | `format/time.js` |
| d3-format / Mike Bostock | ISC | `format/number/number.js` |

## Gantt export plugin scope

pst imports `ExportGanttPlugin` from `@visactor/vtable-plugins/gantt-extensions`. In the installed 1.26.8 package, this export resolves to `es/gantt-export-image.js`. That file imports VTable rendering support and dynamically imports Gantt; it does not import the auto-fill implementation.

The package README separately states that its auto-fill functionality references Univer and is subject to Apache 2.0. Auto-fill was not retained by the checked production browser build. This notice does **not** relicense that functionality as MIT. If auto-fill or a different plugin entry is added, preserve its Apache 2.0 license and any applicable notices as well.

## Installed packages outside the checked browser output

The npm dependency tree also installs packages for other upstream features and environments. For example, `@resvg/resvg-js` declares MPL-2.0, and `jszip` declares `MIT OR GPL-3.0-or-later`. Neither appeared in the retained-module graph for the checked production browser build. ExcelJS, the auto-fill implementation, and the `lottie-web` package were also absent. VRender's small Lottie picker registrations remain covered by the VRender notice above.

This file covers the browser output described above. Distributing a copy of `node_modules`, enabling Node rendering, or adding other plugin entries changes the distribution scope and requires its corresponding license inventory.

## License-text provenance

The npm packages for the VisActor libraries and cssfontparser do not include their upstream standalone license files. Their declared licenses were checked in the installed manifests and the full texts were obtained from the following upstream locations. The retrieved Git blob SHA is recorded in `LICENSE-THIRD-PARTY.txt`.

- [VisActor VTable LICENSE](https://github.com/VisActor/VTable/blob/develop/LICENSE)
- [VisActor VRender LICENSE](https://github.com/VisActor/VRender/blob/develop/LICENSE)
- [VisActor VUtil LICENSE](https://github.com/VisActor/VUtil/blob/main/LICENSE)
- [VisActor VChart LICENSE](https://github.com/VisActor/VChart/blob/develop/LICENSE)
- [cssfontparser LICENSE.txt](https://github.com/tmpvar/cssfontparser/blob/master/LICENSE.txt)
- [Vega LICENSE](https://github.com/vega/vega/blob/main/LICENSE)
- [fmin LICENSE](https://github.com/benfred/fmin/blob/master/LICENSE)
- [venn.js LICENSE](https://github.com/benfred/venn.js/blob/master/LICENSE)
- [d3-time-format LICENSE](https://github.com/d3/d3-time-format/blob/main/LICENSE)
- [d3-format LICENSE](https://github.com/d3/d3-format/blob/main/LICENSE)

The upstream texts above were read on the check date; their source branches are not asserted to be release tags for the installed npm packages. Copyright years and notices have been preserved exactly as provided by those upstream files. License files for EventEmitter3, gifuct-js, js-binary-schema-parser, Lodash, Vite core, and Rolldown were copied from the installed versions. For Vite, only the core-license section applies to the helper inventory here; its separate build-tool dependency-license appendix is not reproduced as a browser dependency inventory.

