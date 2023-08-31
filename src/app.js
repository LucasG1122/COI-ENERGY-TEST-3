const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, Op } = require('sequelize');
const { sequelize } = require('./model');
const { getProfile } = require('./middleware/getProfile');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

// Existing GET /contracts/:id fixed
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const contract = await Contract.findOne({
        where: {
            id,
            [Op.or]: [
                { ContractorId: req.profile.id },
                { ClientId: req.profile.id }
            ]
        }
    });
    if (!contract) return res.status(404).end();
    res.json(contract);
});

// GET /contracts
app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                { ContractorId: req.profile.id },
                { ClientId: req.profile.id }
            ],
            status: {
                [Op.ne]: 'terminated'
            }
        }
    });
    res.json(contracts);
});

// GET /jobs/unpaid
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract } = req.app.get('models');
    const unpaidJobs = await Job.findAll({
        include: [{
            model: Contract,
            where: {
                [Op.or]: [
                    { ContractorId: req.profile.id },
                    { ClientId: req.profile.id }
                ],
                status: 'in_progress'
            }
        }],
        where: {
            paid: false
        }
    });
    res.json(unpaidJobs);
});

// POST /jobs/:job_id/pay
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Profile } = req.app.get('models');
    const { job_id } = req.params;
    
    // Find the job
    const job = await Job.findOne({ where: { id: job_id }});
    if (!job || job.paid) {
        return res.status(400).send('Invalid job ID or already paid.');
    }
    
    // Find related contract
    const contract = await Contract.findOne({ where: { id: job.ContractId }});
    if (!contract || contract.ClientId !== req.profile.id) {
        return res.status(403).send('Forbidden.');
    }
    
    // Check client balance
    if (req.profile.balance < job.price) {
        return res.status(400).send('Insufficient balance.');
    }
    
    // Perform payment: Subtract from client, add to contractor
    const contractor = await Profile.findOne({ where: { id: contract.ContractorId } });
    await Profile.update({ balance: req.profile.balance - job.price }, { where: { id: req.profile.id } });
    await Profile.update({ balance: contractor.balance + job.price }, { where: { id: contractor.id } });
    
    // Update job as paid
    await Job.update({ paid: true, paymentDate: new Date() }, { where: { id: job_id } });
    
    res.status(200).send('Payment successful.');
});

// POST /balances/deposit/:userId
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models');
    const { userId } = req.params;
    const { amount } = req.body;

    if (userId != req.profile.id) {
        return res.status(403).send('Forbidden.');
    }

    if (!amount || amount <= 0) {
        return res.status(400).send('Invalid deposit amount.');
    }

    // Calculate total jobs to pay for validation
    const totalJobsToPay = await Job.sum('price', {
        where: { paid: false },
        include: [{
            model: Contract,
            where: { ClientId: userId, status: 'in_progress' }
        }]
    });

    if (amount > totalJobsToPay * 0.25) {
        return res.status(400).send('Cannot deposit more than 25% of total jobs to pay.');
    }

    await Profile.update({ balance: req.profile.balance + amount }, { where: { id: userId } });
    res.status(200).send(`Deposited $${amount} successfully.`);
});

// GET /admin/best-profession?start=<date>&end=<date>
app.get('/admin/best-profession', async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { start, end } = req.query;

    const bestProfession = await Job.findAll({
        attributes: ['price'],
        include: [{
            model: Contract,
            attributes: [],
            include: [{
                model: Profile,
                attributes: ['profession'],
                where: { type: 'contractor' }
            }],
            where: {
                createdAt: {
                    [Op.between]: [new Date(start), new Date(end)]
                }
            }
        }],
        group: ['Contract.Contractor.profession'],
        order: [[Sequelize.fn('SUM', Sequelize.col('price')), 'DESC']],
        limit: 1,
        raw: true
    });

    if (!bestProfession.length) {
        return res.status(404).send('No professions found.');
    }

    res.json({ profession: bestProfession[0]['Contract.Contractor.profession'] });
});

// GET /admin/best-clients?start=<date>&end=<date>&limit=<integer>
app.get('/admin/best-clients', async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { start, end, limit = 2 } = req.query;

    const bestClients = await Job.findAll({
        attributes: [[Sequelize.fn('SUM', Sequelize.col('price')), 'paid']],
        include: [{
            model: Contract,
            attributes: [],
            include: [{
                model: Profile,
                attributes: ['id', 'firstName', 'lastName']
            }],
            where: {
                createdAt: {
                    [Op.between]: [new Date(start), new Date(end)]
                }
            }
        }],
        group: ['Contract.ClientId'],
        order: [[Sequelize.fn('SUM', Sequelize.col('price')), 'DESC']],
        limit,
        raw: true
    });

    const result = bestClients.map(client => ({
        id: client['Contract.Client.id'],
        fullName: `${client['Contract.Client.firstName']} ${client['Contract.Client.lastName']}`,
        paid: parseFloat(client.paid)
    }));

    res.json(result);
});

module.exports = app;
