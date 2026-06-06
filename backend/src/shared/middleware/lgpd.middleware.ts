import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SENSITIVE_HEADERS = ['x-cpf', 'x-rg', 'x-cnpj', 'x-phone'];

@Injectable()
export class LgpdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('X-Data-Processing-Basis', 'legitimate-interest');
    res.setHeader('X-Privacy-Policy', 'https://meuimovel.com.br/privacidade');
    for (const h of SENSITIVE_HEADERS) delete req.headers[h];
    next();
  }
}
