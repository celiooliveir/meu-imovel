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
    expect(next).toHaveBeenCalled();
  });

  it('should strip sensitive headers before processing', () => {
    mockReq.headers['x-cpf'] = '12345678900';
    middleware.use(mockReq, mockRes, next);
    expect(mockReq.headers['x-cpf']).toBeUndefined();
  });
});
