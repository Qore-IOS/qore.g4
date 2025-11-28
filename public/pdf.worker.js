/**
 * @licstart The following is the entire license notice for the
 * Javascript code in this file.
 *
 * Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @licend The above is the entire license notice for the
 * Javascript code in this file.
 */

/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
var __webpack_exports__ = {};

;// CONCATENATED MODULE: ./node_modules/pdfjs-dist/build/pdf.worker.mjs
/*!
 * PDF.js v4.5.136 (build: 228a25712)
 * Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


const pdfjsVersion = "4.5.136";
const pdfjsBuild = "228a25712";
const pdfjsSharedUtil = globalThis.pdfjsSharedUtil;
const WorkerMessageHandler = globalThis.WorkerMessageHandler;
pdfjsSharedUtil.setVerbosityLevel(pdfjsSharedUtil.VerbosityLevel.INFOS);
WorkerMessageHandler.create(globalThis.pdfjsWorker);
globalThis.pdfjsSharedUtil = pdfjsSharedUtil;
globalThis.WorkerMessageHandler = WorkerMessageHandler;
/******/ })()
;
//# sourceMappingURL=pdf.worker.js.map
