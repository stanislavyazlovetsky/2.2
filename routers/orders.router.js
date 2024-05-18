import { Router } from 'express';
import { authorizationMiddleware } from '../middlewares.js';
import { ORDERS, ADDRESSES } from '../db.js';

export const OrdersRouter = Router();

const convertToDate = (date) => {


  if (!/^\d\d-\d\d-\d{4}$/.test(date)) {
    throw new Error(`parameter createdAt has wrong format`);
  }

  const [day, month, year] = date.split('-');

  const mothsInt = parseInt(month);
  if (mothsInt < 1 || mothsInt > 12) {

    throw new Error(`parameter createdAt has wrong month value`);
  }

  const result = new Date();
  result.setHours(2);
  result.setMinutes(0);
  result.setMilliseconds(0);
  result.setSeconds(0);

  result.setMonth(mothsInt - 1);
  result.setDate(day);
  result.setFullYear(year);

  return result;
};

const convertToDateMiddleware = (fieldName) => (req, res, next) => {
  const valueString = req.query[fieldName];

  if (!valueString) {
    return next();
  }
  try {
    const value = convertToDate(valueString);
    req.query[fieldName] = value;
    return next();
  } catch (err) {
    return res.status(400)
      .send({ message: err.toString() });
  }
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const distance = Math.abs(lat1 - lat2) + Math.abs(lon1 - lon2);
  return distance;
}

OrdersRouter.post('/orders', authorizationMiddleware, (req, res) => {
  const { body, user } = req;

  const createdAt = new Date();
  createdAt.setHours(2);
  createdAt.setMinutes(0);
  createdAt.setMilliseconds(0);
  createdAt.setSeconds(0);

  // Оновити логіку створення замовлення таким чином, що якщо значення 
  // полів from або to не є доступні у таблиці addresses, то видавати помилку.
  const fromAddress = ADDRESSES.find(address => address.name === body.from);
  const toAddress = ADDRESSES.find(address => address.name === body.to);

  if (!fromAddress || !toAddress) {
    return res.status(400).send({ message: 'The addresses are not valid.' });
  }

  if (!user) {
    return res.status(400).send({ message: 'User is not found' });
  }

  const distance = calculateDistance(fromAddress.location.latitude, fromAddress.location.longitude, toAddress.location.latitude, toAddress.location.longitude);

  // Оновити логіку створення замовлення таким чином, що б користувачу у відповідь надсилавс не тільки стоврене замовлення,
  // але і поле distance яке вираховуються на основі координат і повертається у форматі кілометрів
  let price;
  switch (body.type) {
    case "standard":
      price = distance * 2.5;
      break;
    case "lite":
      price = distance * 1.5;
      break;
    case "universal":
      price = distance * 3;
      break;
    default:
      return res.status(400).send({ message: 'Order type is wrong' });
  }

  const order = {
    ...body,
    login: user.login,
    createdAt,
    distance: distance + " km",
    price: "$" + price.toFixed(2),
    status: "Active",
    id: crypto.randomUUID(),
  };

  ORDERS.push(order);

  return res.status(200).send({ message: 'Your order was created', order });
});


OrdersRouter.get('/orders', authorizationMiddleware,
  convertToDateMiddleware('createdAt'),
  convertToDateMiddleware('createdFrom'),
  convertToDateMiddleware('createdTo'),
  (req, res) => {
    const { user, query } = req;

    if (query.createdAt && query.createdFrom && query.createdTo) {
      return res.status(400).send({ message: "Too many parameter in query string" });
    }

    console.log(`query`, JSON.stringify(query));

    let orders = ORDERS.filter(el => el.login === user.login);

    if (user.role === 'Driver') {
      orders = ORDERS.filter(el => el.status === 'Active');

    } else if (user.role === 'Admin') {
      orders = ORDERS;

    } else {
      orders = ORDERS.filter(el => el.login === user.login);
    }

    if (query.createdAt) {

      try {
        orders = ORDERS.filter(el => {
          const value = new Date(el.createdAt);
          return value.getTime() === query.createdAt.getTime();
        });
      } catch (err) {
        return res.status(400)
          .send({ message: err.toString() });
      }
    }

    if (query.createdFrom) {
      try {
        orders = ORDERS.filter(el => {
          const value = new Date(el.createdAt);
          return value.getTime() >= query.createdFrom.getTime();
        });
      } catch (err) {
        return res.status(400)
          .send({ message: err.toString() });
      }
    }

    if (query.createdTo) {
      try {
        orders = ORDERS.filter(el => {
          const value = new Date(el.createdAt);
          return value.getTime() <= query.createdTo.getTime();
        });
      } catch (err) {
        return res.status(400)
          .send({ message: err.toString() });
      }
    }

    return res.status(200).send(orders);
  });

OrdersRouter.patch('/orders/:orderId', authorizationMiddleware, (req, res) => {
  const { params, body, user } = req;

  let order = ORDERS.find(el => el.id === params.orderId);

  if (!order) {
    return res.status(404).send({ message: `Order with id ${params.orderId} was not found` });
  }

  if (order.status === 'Done') {
    return res.status(400).send({ message: `Order status can't be changed` });

  }

  if (user && user.role === 'Customer') {

    if (order.status !== 'Active') {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    if (body.status !== 'Rejected') {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    ORDERS.update((el) => el.id === params.orderId, { status: body.status });
    return res.status(200).send({ message: `Order status changed` });
  }

  if (user && user.role === 'Driver') {

    if (!['Active', 'In progress'].includes(order.status)) {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    if (order.status === 'Active' && body.status !== 'In progress') {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    if (order.status == 'In progress' && body.status !== 'Done') {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    ORDERS.update((el) => el.id === params.orderId, { status: body.status });
    return res.status(200).send({ message: `Order status changed` });
  }

  if (user && user.role === 'Admin') {

    if (!['Active', 'In progress'].includes(order.status)) {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    if (order.status === 'Active' && !['Rejected', 'In progress'].includes(body.status)) {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    if (order.status == 'In progress' && body.status !== 'Done') {
      return res.status(400).send({ message: `Order status can't be changed` });
    }

    ORDERS.update((el) => el.id === params.orderId, { status: body.status });
    return res.status(200).send({ message: `Order status changed` });

  }

  return res.status(400).send({ message: `Order status can't be changed` });
});


OrdersRouter.get('/to/last-5', authorizationMiddleware, (req, res) => {
  const user = req.user;
  const userOrders = ORDERS.filter(order => order.login === user.login);
  const uniqueAddresses = [...new Set(userOrders.map(order => order.from))];
  const last5UniqueAddresses = uniqueAddresses.slice(-5);
  res.status(200).json(last5UniqueAddresses);
});

// Отримати останні 3 адреси доставки для замовлень користувача
OrdersRouter.get('/to/last-3-to', authorizationMiddleware, (req, res) => {
  const user = req.user;
  const userOrders = ORDERS.filter(order => order.login === user.login);
  const uniqueAddresses = [...new Set(userOrders.map(order => order.to))];
  const last3UniqueAddresses = uniqueAddresses.slice(-3);
  res.status(200).json(last3UniqueAddresses);
});

