import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import customerDetailsRouter from "./customer-details";
import productsRouter from "./products";
import productAttributesRouter from "./product-attributes";
import suppliersRouter from "./suppliers";
import ordersRouter from "./orders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(customerDetailsRouter);
router.use(productsRouter);
router.use(productAttributesRouter);
router.use(suppliersRouter);
router.use(ordersRouter);

export default router;
