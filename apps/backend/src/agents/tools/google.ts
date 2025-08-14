import { ToolResult } from '../../types/agent';
import { google } from 'googleapis';
import config from '../../config/sol.config.json';
import { Logger } from '../../services/logger';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents'
  ]
});

const sheets = google.sheets({ version: 'v4', auth });
const docs = google.docs({ version: 'v1', auth });
const drive = google.drive({ version: 'v3', auth });

export const googleTool = {
  async run(params: {
    operation: 'sheets_append' | 'docs_append' | 'drive_upload',
    targetId: string,
    data: any
  }): Promise<ToolResult> {
    if (!config.tools?.google?.enabled) {
      return {
        jobId: `google-${Date.now()}`,
        status: 'error',
        events: [{ type: 'error', data: { message: 'Google tool disabled in config' } }],
        artifacts: []
      };
    }

    try {
      Logger.log({
        level: 'debug',
        message: 'Tool called',
        metadata: { tool: 'google', params, source: 'system' }
      });
      
      let result: any;
      
      switch (params.operation) {
        case 'sheets_append':
          result = await sheets.spreadsheets.values.append({
            spreadsheetId: params.targetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: Array.isArray(params.data) ? params.data : [params.data]
            }
          });
          break;
          
        case 'docs_append':
          result = await docs.documents.batchUpdate({
            documentId: params.targetId,
            requestBody: {
              requests: [{
                insertText: {
                  location: {
                    index: 1
                  },
                  text: `\n${params.data}\n`
                }
              }]
            }
          });
          break;
          
        case 'drive_upload':
          result = await drive.files.create({
            requestBody: {
              name: params.data.name,
              mimeType: params.data.mimeType,
              parents: [params.targetId]
            },
            media: {
              mimeType: params.data.mimeType,
              body: params.data.content
            }
          });
          break;
      }
      
      const toolResult: ToolResult = {
        jobId: `google-${Date.now()}`,
        status: 'ok',
        events: [{
          type: 'google_success', 
          data: { operation: params.operation }
        }],
        artifacts: [{
          type: 'google_result',
          data: result.data
        }]
      };
      
      Logger.logToolResult(toolResult, 'system');
      return toolResult;
      
    } catch (error: any) {
      Logger.log({
        level: 'error',
        message: 'Google operation failed',
        metadata: {
          operation: params.operation,
          error: error.message
        }
      });
      
      return {
        jobId: `google-${Date.now()}`,
        status: 'error',
        events: [{
          type: 'error',
          data: {
            message: 'Google operation failed',
            details: error?.message || String(error)
          }
        }],
        artifacts: []
      };
    }
  }
};
