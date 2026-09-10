import { isMutation, requestSchema, responseSchema, type PluginRequest, type Response } from '../src/protocol.js';
import { currentDocument, PluginError } from './document.js';
import { readNodes } from './read.js';
import { exportNodes } from './export.js';
import { mutate } from './mutations.js';
import { boundedResponse } from './wire-size.js';

figma.showUI(__html__, { width: 320, height: 380, themeColors: true });

const mutationIds = new Set<string>();
let queue: Promise<void> = Promise.resolve();

function publishDocument() {
  try { figma.ui.postMessage({ type: 'document', document: currentDocument() }); } catch {}
}

async function execute(request: PluginRequest): Promise<Response> {
  try {
    if (Date.now() >= request.expiresAt) throw new PluginError('REQUEST_EXPIRED', 'The request expired before execution.');
    if (isMutation(request.command)) {
      if (mutationIds.has(request.requestId)) throw new PluginError('DUPLICATE_MUTATION', 'This mutation request was already received; inspect the document before retrying.');
      if (mutationIds.size >= 10000) throw new PluginError('MUTATION_LIMIT', 'Restart the plugin before sending further edits.');
      mutationIds.add(request.requestId);
    }
    const { command } = request;
    let data: unknown;
    switch (command.operation) {
      case 'selection': data = currentDocument(); break;
      case 'read': data = await readNodes(command.params); break;
      case 'export': data = await exportNodes(command.params); break;
      case 'create':
      case 'update': data = await mutate(command, request.expiresAt); publishDocument(); break;
    }
    return responseSchema.parse({ type: 'response', requestId: request.requestId, ok: true, data });
  } catch (error) {
    return {
      type: 'response', requestId: request.requestId, ok: false,
      error: {
        code: error instanceof PluginError ? error.code : 'FIGMA_ERROR',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        ...(error instanceof PluginError && error.details ? { details: error.details } : {})
      }
    };
  }
}

figma.ui.onmessage = (message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'ready') {
    publishDocument();
    return;
  }
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return;
  queue = queue.then(async () => {
    figma.ui.postMessage(boundedResponse(await execute(parsed.data), parsed.data.command.operation));
  }).catch(() => {});
};
figma.on('selectionchange', publishDocument);
figma.on('currentpagechange', publishDocument);
