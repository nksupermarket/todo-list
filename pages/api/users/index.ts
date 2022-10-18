import { body, validationResult } from 'express-validator';
import { NextApiRequest, NextApiResponse } from 'next';
import { connectToPool } from '../../../utils/pool';
import initMiddleware from '../../../utils/initMiddleware';
import validateMiddleware from '../../../utils/validateMiddleware';
import {
  checkPassword,
  checkUsername,
  isValueUnique,
} from '../../../utils/validators';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { withIronSessionApiRoute } from 'iron-session/next';
import { sessionOptions } from '../../../utils/session';
import { UserData } from '../../../types/interfaces';

let client: PoolClient | undefined;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = connectToPool();
  client = client || (await pool.connect());
  switch (req.method) {
    case 'POST': {
      try {
        await initMiddleware(
          validateMiddleware([
            body('username')
              .trim()
              .notEmpty()
              .withMessage('username is missing')
              .isLength({ max: 20, min: 6 })
              .withMessage('username must be between 6 and 20 characters')
              .custom(async function isUsernameInUse(username: string) {
                const result = await isValueUnique(
                  client as PoolClient,
                  username,
                  'users',
                  'username'
                );
                if (!result) throw new Error('username is in use');
                return true;
              })
              .custom(function matchRegEx(username: string) {
                const result = checkUsername(username);
                if (result.error) throw new Error(result.error);
                return true;
              }),
            body('password')
              .trim()
              .notEmpty()
              .withMessage('password is missing')
              .isLength({ max: 20, min: 8 })
              .withMessage('password must be between 8 and 20 characters')
              .custom(function matchRegEx(password: string) {
                const result = checkPassword(password);
                if (result.error) throw new Error(result.error);
                return true;
              }),
          ])
        )(req, res);

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(422).json({ errors: errors.array() });
        }

        const hashed = await hash(req.body.password, 10);
        const uuid = randomUUID();
        await client.query(
          `INSERT INTO ${process.env.SCHEMA}.users (id, username, password) VALUES ('${uuid}', '${req.body.username}', '${hashed}')`
        );

        const user: UserData = {
          id: uuid,
          loggedIn: true,
          username: req.body.username,
          todos: '',
          projects: '',
        };
        req.session.user = user;
        await req.session?.save();

        return res.status(200).end();
      } catch (err) {
        return res.status(500).json(err);
      } finally {
        client.release(true);
        client = undefined;
      }
    }
    default:
      return res.status(405).send('no user logged in');
  }
}

export default withIronSessionApiRoute(handler, sessionOptions);