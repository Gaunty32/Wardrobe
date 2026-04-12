import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import customerDetailsRouter from "./customer-details";
import productsRouter from "./products";
import productAttributesRouter from "./product-attributes";
import productVariantsRouter from "./product-variants";
import suppliersRouter from "./suppliers";
import ordersRouter from "./orders";
import processStockRouter from "./process-stock";
import purchasingRouter from "./purchasing";
import worksheetsRouter from "./worksheets";
import settingsRouter from "./settings";
import dispatchRouter from "./dispatch";
import xeroRouter from "./xero";
import tasksRouter from "./tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(customerDetailsRouter);
router.use(productsRouter);
router.use(productAttributesRouter);
router.use(productVariantsRouter);
router.use(suppliersRouter);
router.use(ordersRouter);
router.use(processStockRouter);
router.use(purchasingRouter);
router.use(worksheetsRouter);
router.use(settingsRouter);
router.use(dispatchRouter);
router.use(xeroRouter);
router.use(tasksRouter);

export default router;
