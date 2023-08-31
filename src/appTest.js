const request = require('supertest');
const app = require('./app');

describe('API Endpoints', () => {
    let api;
    beforeAll(() => {
        // Initialize server and routes
        api = app.listen(4000, () => {
            console.log('Test server running on port 4000');
        });
    });

    afterAll((done) => {
        // Close server after all tests
        console.log('Gracefully stopping test server');
        api.close(done);
    });

    it('Should get contract by id', async () => {
        const res = await request(api).get('/contracts/1').set('profile_id', '1');
        expect(res.statusCode).toEqual(200);
        expect(res.body.id).toEqual(1);
    });

    it('Should get a list of contracts', async () => {
        const res = await request(api).get('/contracts').set('profile_id', '1');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveLength(3); // assuming there are 3 contracts for this profile
    });

    it('Should get all unpaid jobs for a user', async () => {
        const res = await request(api).get('/jobs/unpaid').set('profile_id', '1');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveLength(2); // assuming there are 2 unpaid jobs for this profile
    });
});
