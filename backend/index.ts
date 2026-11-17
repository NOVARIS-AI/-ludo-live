import { db, error, json, router, type RouterContext } from '@appdeploy/sdk';
import { ludoRoutes } from './ludo';
import { competitionRoutes } from './competition';
import { playerFeatureRoutes } from './player-features';
import { realtimeSubscriptionRoutes } from './realtime-subscribers';

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  ...realtimeSubscriptionRoutes,
  ...ludoRoutes,
  ...competitionRoutes,
  ...playerFeatureRoutes,
});
