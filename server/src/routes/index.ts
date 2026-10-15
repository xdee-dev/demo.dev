import { Router } from 'express';
import { customersRouter } from './customers.js';
import { vehiclesRouter } from './vehicles.js';
import { reservationsRouter } from './reservations.js';
import { rentalsRouter } from './rentals.js';
import { financeRouter } from './finance.js';
import { maintenanceRouter } from './maintenance.js';
import { filesRouter } from './files.js';
import { dashboardRouter } from './dashboard.js';
import { reportsRouter } from './reports.js';
import { importsRouter } from './imports.js';

/** Tenant-scoped API. Mounted after requireAuth + requireCompany. */
export const apiRouter = Router();
apiRouter.use(customersRouter);
apiRouter.use(vehiclesRouter);
apiRouter.use(reservationsRouter);
apiRouter.use(rentalsRouter);
apiRouter.use(financeRouter);
apiRouter.use(maintenanceRouter);
apiRouter.use(filesRouter);
apiRouter.use(dashboardRouter);
apiRouter.use(reportsRouter);
apiRouter.use(importsRouter);
