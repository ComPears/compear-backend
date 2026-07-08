import { Router } from 'express';
import { compareByCanonicalName } from '../controllers/compareController';

export const compareRouter = Router();
compareRouter.get('/:canonicalName', compareByCanonicalName);
