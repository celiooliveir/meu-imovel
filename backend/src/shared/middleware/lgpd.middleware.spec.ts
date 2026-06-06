import { LgpdMiddleware } from './lgpd.middleware';

describe('LgpdMiddleware', () => {
  let middleware: LgpdMiddleware;
  let mockReq: any;
  let mockRes: any;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new LgpdMiddleware();
    mockReq = { headers: {} };
    mockRes = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('should add LGPD security headers and call next', () => {
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Data-Processing-Basis',
      'legitimate-interest',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Privacy-Policy',
      'https://meuimovel.com.br/privacidade',
    );
    expect(next).toHaveBeenCalled();
  });

  it.each(['x-cpf', 'x-rg', 'x-cnpj', 'x-phone'])(
    'should strip sensitive header %s before processing',
    (header) => {
      mockReq.headers[header] = 'some-value';
      middleware.use(mockReq, mockRes, next);
      expect(mockReq.headers[header]).toBeUndefined();
    },
  );
});
