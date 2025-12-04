import { config, logger } from '@barbershop/shared';

import { createApp } from './app';

const app = createApp();

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'Scheduling service listening');
});
