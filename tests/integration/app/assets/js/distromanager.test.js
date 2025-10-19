const { setupServer } = require('msw/node');
const { http, HttpResponse } = require('msw');
const { DistroAPI } = require('@app/assets/js/distromanager');

const server = setupServer(
  http.get('https://f-launcher.ru/fox/new/distribution.json', () => {
    return HttpResponse.json({
      version: '1.0.0',
      servers: [],
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DistroManager', () => {
  it('should fetch the distribution index', async () => {
    const distro = await DistroAPI.getDistribution();
    expect(distro.rawDistribution.version).toBe('1.0.0');
  });
});
