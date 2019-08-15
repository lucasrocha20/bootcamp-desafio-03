import * as Yup from 'yup';
import { startOfHour, isBefore } from 'date-fns';

import { Op } from 'sequelize';
import Subscription from '../models/Subscription';
import Meetup from '../models/Meetup';
import User from '../models/User';

import InscriptionMail from '../jobs/InscriptionMail';
import Queue from '../../lib/Queue';

class SubscriptionController {
  async index(req, res) {
    const subscriptions = await Subscription.findAll({
      where: {
        user_id: req.userId,
      },
      include: [
        {
          model: Meetup,
          attributes: ['id', 'title', 'date', 'user_id', 'file_id'],
          where: {
            date: { [Op.gt]: new Date() },
          },
          required: true,
        },
      ],
      order: [[Meetup, 'date']],
    });

    return res.json(subscriptions);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      user_id: Yup.number(),
      meetup_id: Yup.number().required(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const user = await User.findByPk(req.userId);
    const meetup = await Meetup.findByPk(req.body.meetup_id, {
      include: [User],
    });

    if (meetup.user_id === req.userId) {
      return res
        .status(400)
        .json({ error: 'User organizer can not register in the same event' });
    }

    const hourStart = startOfHour(meetup.date);
    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({
        error: 'You can not sign up for an event that has passed',
      });
    }

    const registerMeetup = await Subscription.findOne({
      where: {
        user_id: req.userId,
        meetup_id: req.body.meetup_id,
      },
    });

    if (registerMeetup) {
      return res.status(401).json({ error: 'User is already subscribed' });
    }

    const checkDate = await Subscription.findOne({
      where: {
        user_id: req.userId,
      },
      include: [
        {
          model: Meetup,
          required: true,
          where: {
            date: meetup.date,
          },
        },
      ],
    });

    if (checkDate) {
      return res
        .status(401)
        .json('It is not possible to sign up for an event at the same time');
    }

    const meetupInscription = await Subscription.create({
      user_id: req.userId,
      meetup_id: req.body.meetup_id,
    });

    Queue.add(InscriptionMail.key, {
      meetup,
      user,
    });

    return res.json(meetupInscription);
  }
}

export default new SubscriptionController();
