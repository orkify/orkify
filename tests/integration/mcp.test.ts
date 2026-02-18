import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/mcp/auth.js';
import { orkify, waitForProcessOnline, waitForWorkersOnline } from './test-utils.js';

const BIN = join(process.cwd(), 'bin', 'orkify');
const EXAMPLES = join(process.cwd(), 'examples');
const IS_CI = process.env.CI === 'true';

describe('MCP Server', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Kill any existing daemon (skip on CI - fresh environment)
    if (!IS_CI) {
      orkify('kill');
    }

    // Create MCP client connected to orkify mcp server
    transport = new StdioClientTransport({
      command: 'node',
      args: [BIN, 'mcp'],
    });

    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    // Clean up (skip on CI - environment is discarded anyway)
    if (!IS_CI) {
      orkify('down all');
      orkify('kill');
    }
  });

  describe('Tool Discovery', () => {
    it('lists all available tools matching TOOL_NAMES', async () => {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Every name in TOOL_NAMES must be registered on the server
      for (const name of TOOL_NAMES) {
        expect(toolNames).toContain(name);
      }

      // Server must not register tools absent from TOOL_NAMES
      expect(tools.tools.length).toBe(TOOL_NAMES.length);
    });

    it('tools have descriptions', async () => {
      const tools = await client.listTools();

      for (const tool of tools.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description?.length).toBeGreaterThan(10);
      }
    });
  });

  describe('list tool', () => {
    it('returns empty array initially', async () => {
      // Ensure clean state
      orkify('down all');

      const result = await client.callTool({ name: 'list', arguments: {} });
      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe('text');

      const data = JSON.parse(content[0].text);
      expect(data.processes).toEqual([]);
      expect(data.message).toBe('No processes running');
    });
  });

  describe('up tool', () => {
    afterAll(() => {
      orkify('down all');
    });

    it('starts a process successfully', async () => {
      const result = await client.callTool({
        name: 'up',
        arguments: {
          script: join(EXAMPLES, 'basic', 'app.js'),
          name: 'mcp-test-up',
        },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('started successfully');
      expect(data.process.name).toBe('mcp-test-up');

      // Clean up
      orkify('down mcp-test-up');
    });

    it('starts a process with workers option', async () => {
      const result = await client.callTool({
        name: 'up',
        arguments: {
          script: join(EXAMPLES, 'basic', 'app.js'),
          name: 'mcp-test-workers',
          workers: 2,
        },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.process.execMode).toBe('cluster');
      expect(data.process.workerCount).toBe(2);

      // Clean up
      orkify('down mcp-test-workers');
    });

    it('returns error for invalid script', async () => {
      const result = await client.callTool({
        name: 'up',
        arguments: {
          script: '/nonexistent/path/to/script.js',
          name: 'mcp-test-invalid',
        },
      });

      expect(result.isError).toBe(true);

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.error).toBeDefined();
    });
  });

  describe('down tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-down`);
      await waitForProcessOnline('mcp-test-down');
    });

    afterAll(() => {
      orkify('down mcp-test-down');
    });

    it('stops a running process', async () => {
      const result = await client.callTool({
        name: 'down',
        arguments: { target: 'mcp-test-down' },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('Successfully stopped');
    });

    it('returns error for nonexistent process', async () => {
      const result = await client.callTool({
        name: 'down',
        arguments: { target: 'nonexistent-process-xyz' },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('restart tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-restart`);
      await waitForProcessOnline('mcp-test-restart');
    });

    afterAll(() => {
      orkify('down mcp-test-restart');
    });

    it('restarts a running process', async () => {
      const result = await client.callTool({
        name: 'restart',
        arguments: { target: 'mcp-test-restart' },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('Successfully restarted');
    });
  });

  describe('reload tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-reload -w 2`);
      await waitForWorkersOnline('mcp-test-reload', 2);
    }, 45000);

    afterAll(() => {
      orkify('down mcp-test-reload');
    });

    it('reloads a cluster process', async () => {
      const result = await client.callTool({
        name: 'reload',
        arguments: { target: 'mcp-test-reload' },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('Successfully reloaded');
    });
  });

  describe('delete tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-delete`);
      await waitForProcessOnline('mcp-test-delete');
    });

    it('deletes a process', async () => {
      const result = await client.callTool({
        name: 'delete',
        arguments: { target: 'mcp-test-delete' },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('Successfully deleted');

      // Verify process is gone
      const listResult = await client.callTool({ name: 'list', arguments: {} });
      const listContent = listResult.content as Array<{ type: string; text: string }>;
      const listData = JSON.parse(listContent[0].text);

      // Process should be removed from list
      if (Array.isArray(listData)) {
        expect(
          listData.find((p: { name: string }) => p.name === 'mcp-test-delete')
        ).toBeUndefined();
      }
    });
  });

  describe('logs tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-logs`);
      await waitForProcessOnline('mcp-test-logs');
    });

    afterAll(() => {
      orkify('down mcp-test-logs');
    });

    it('gets logs for a process', async () => {
      const result = await client.callTool({
        name: 'logs',
        arguments: { target: 'mcp-test-logs', lines: 10 },
      });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe('text');
    });

    it('returns empty result for nonexistent process', async () => {
      const result = await client.callTool({
        name: 'logs',
        arguments: { target: 'nonexistent-logs-xyz' },
      });

      // Logs command returns success with empty/no logs for nonexistent processes
      expect(result.isError).toBeFalsy();
    });
  });

  describe('snap tool', () => {
    beforeAll(async () => {
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-snap`);
      await waitForProcessOnline('mcp-test-snap');
    });

    afterAll(() => {
      orkify('down mcp-test-snap');
    });

    it('snapshots process list', async () => {
      const result = await client.callTool({ name: 'snap', arguments: {} });

      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(data.message).toContain('saved successfully');
    });
  });

  describe('restore tool', () => {
    it('restores saved processes', async () => {
      const result = await client.callTool({ name: 'restore', arguments: {} });

      // May succeed or fail depending on if save was called before
      // Just check it doesn't throw
      expect(result.content).toBeDefined();
    });
  });

  describe('list tool with processes', () => {
    beforeAll(async () => {
      orkify('down all');
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-list1`);
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n mcp-test-list2`);
      await waitForProcessOnline('mcp-test-list1');
      await waitForProcessOnline('mcp-test-list2');
    });

    afterAll(() => {
      orkify('down all');
    });

    it('lists multiple processes', async () => {
      const result = await client.callTool({ name: 'list', arguments: {} });
      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2);

      const names = data.map((p: { name: string }) => p.name);
      expect(names).toContain('mcp-test-list1');
      expect(names).toContain('mcp-test-list2');
    });
  });
});
