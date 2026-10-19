// QuickJS for the phone test page: both builds (plain and with pauses), with their WebAssembly inside the file, as one
// script that sets self.QJS (bundled by build-page.js with esbuild).
import { newQuickJSWASMModuleFromVariant, newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten-core';
import syncVariant from '@jitl/quickjs-singlefile-browser-release-sync';
import asyncVariant from '@jitl/quickjs-singlefile-browser-release-asyncify';

self.QJS = { newQuickJSWASMModuleFromVariant, newQuickJSAsyncWASMModuleFromVariant, syncVariant, asyncVariant };
