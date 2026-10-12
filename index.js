import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TransportClient } from './src/client.js';
import { TransportService } from './src/transport.js';
import { createIntegration } from './src/integration.js';

const gladys = new GladysIntegration();
createIntegration(gladys, new TransportService(new TransportClient()), logger);
logger.info('Starting Swiss Transports');
gladys.connect().catch(() => {
  logger.error('Initial Gladys connection failed.');
  process.exitCode = 1;
});
