import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import customerDetailsRouter from "./customer-details";
import productsRouter from "./products";
import ordersRouter from "./orders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(customerDetailsRouter);
router.use(productsRouter);
router.use(ordersRouter);

export default router;
