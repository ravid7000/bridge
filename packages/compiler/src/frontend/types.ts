import type { Module } from '@swc/core';

import type { FileId } from '../types.js';

export interface ParsedModule {
  fileId: FileId;
  ast: Module;
  code: string;
}
